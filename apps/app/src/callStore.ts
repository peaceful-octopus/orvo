import { EffectsController, type GifMode, type GifSource } from '@chillcall/effects';
import {
  InvalidTokenError,
  JoinError,
  LoginRequiredError,
  MeshTransport,
  RoomFullError,
  UpgradeRequiredError,
  type PeerRoute,
  type PeerState,
  type RoomEvent,
} from '@chillcall/rtc';
import { create } from 'zustand';
import { CLIENT_VERSION, getServerUrl, loadClientConfig } from './config';
import {
  deviceConstraint,
  loadSelection,
  noDevices,
  saveSelection,
  toDeviceLists,
  validSelection,
  type DeviceKind,
  type DeviceLists,
  type DeviceSelection,
} from './devices';
import { createMicProcessor, noiseSupported, type MicProcessor } from './noise';
import { createVision, visionSupported } from './vision';
import { useSettings } from './settingsStore';
import { useAuth } from './auth/authStore';
import { COPY, MEDIA_DENIED_MESSAGE } from './copy';
import { toast } from './toastStore';
import { telemetry } from './telemetry';

export interface Remote {
  id: string;
  name: string;
  /** Their camera and microphone. */
  stream?: MediaStream;
  /** Their shared screen, once we know which of their streams it is. */
  screen?: MediaStream;
  /** Every stream they send, by id, and the id of the shared screen once they have said which it is. */
  streams?: Record<string, MediaStream>;
  screenId?: string;
  audio: boolean;
  video: boolean;
  state: PeerState;
  route: PeerRoute;
}

type Phase = 'lobby' | 'joining' | 'in-call';

interface CallState {
  phase: Phase;
  error?: string;
  local?: MediaStream;
  /** What your own bubble shows: the camera, or the camera with reactions and GIFs drawn on it while they run. */
  localDisplay?: MediaStream;
  audio: boolean;
  video: boolean;
  /** The cameras, microphones and speakers the system offers, and which of them are chosen. */
  devices: DeviceLists;
  selected: DeviceSelection;
  /** The room being joined or in, and who may join it. `owner` means you can change that. */
  roomId?: string;
  roomAccess?: { signedInOnly: boolean; owner: boolean };
  /** Why joining needs a sign-in, when it does: to start this room, to enter it, or because the old sign-in ran out. */
  loginRequired?: 'create' | 'join' | 'expired';
  /** Your own shared screen, while you are sharing. */
  screen?: MediaStream;
  /** Whether background noise suppression is running on your microphone. */
  noiseStatus: 'off' | 'loading' | 'on' | 'error';
  /** Whether the connection to the signaling server is up; calls continue while it reconnects. */
  reconnecting: boolean;
  remotes: Record<string, Remote>;
  startPreview(): Promise<void>;
  join(room: string, name: string): Promise<void>;
  toggleAudio(): Promise<void>;
  toggleVideo(): Promise<void>;
  setRoomAccess(signedInOnly: boolean): Promise<void>;
  shareScreen(): Promise<void>;
  stopScreen(): void;
  applyNoise(): Promise<void>;
  refreshDevices(): Promise<void>;
  /** Switches to a device; resolves to whether it worked. `quiet` leaves the error message to the caller. */
  selectDevice(kind: DeviceKind, id: string, quiet?: boolean): Promise<boolean>;
  react(emoji: string): Promise<void>;
  sendGif(source: GifSource, mode: GifMode): Promise<void>;
  leave(): void;
}

let transport: MeshTransport | undefined;
let unsubscribe: (() => void) | undefined;
let effects: EffectsController | undefined;
/** The microphone as the browser gives it; what is sent is this, or its noise-filtered version. */
let micRaw: MediaStreamTrack | undefined;
let micProcessor: MicProcessor | undefined;
let noiseQueue: Promise<void> = Promise.resolve();

/** One new track from the chosen device; if that device is gone, from the system default instead. */
async function acquireTrack(kind: 'audioinput' | 'videoinput', id: string): Promise<{ track: MediaStreamTrack; id: string }> {
  const key = kind === 'audioinput' ? 'audio' : 'video';
  const get = (wanted: string) => navigator.mediaDevices.getUserMedia({ [key]: deviceConstraint(wanted) });
  let stream: MediaStream;
  let used = id;
  try {
    stream = await get(id);
  } catch (err) {
    if (!id) throw err;
    stream = await get('');
    used = '';
  }
  return { track: stream.getTracks()[0]!, id: used };
}

const lookFromSettings = () => {
  const { blurBackground, autoFrame } = useSettings.getState();
  return { blurBackground, autoFrame };
};

export const useCall = create<CallState>((set, get) => {
  const broadcastState = () => {
    const { audio, video } = get();
    transport?.send({ kind: 'state', audio, video });
  };

  /** What goes out: your microphone, and your video as filtered or decorated if that is running, else the camera. */
  const outgoing = (): MediaStream | undefined => {
    const { local, localDisplay, video } = get();
    if (!local) return undefined;
    const drawn = localDisplay?.getVideoTracks()[0];
    if (drawn) drawn.enabled = video;
    return new MediaStream([...local.getAudioTracks(), ...(drawn ? [drawn] : local.getVideoTracks())]);
  };
  const publish = async () => {
    const stream = outgoing();
    if (stream) await transport?.replaceLocalStream(stream);
  };

  const blank = (id: string): Remote => ({ id, name: '', audio: true, video: true, state: 'connecting', route: 'unknown' });

  /**
   * Works out which of a person's streams is their camera and which their screen. The screen is the one they have
   * announced by id; the camera is whichever other stream arrived first.
   */
  const sortStreams = (remote: Remote, added: Record<string, MediaStream>): Remote => {
    const streams = { ...remote.streams, ...added };
    const screen = remote.screenId ? streams[remote.screenId] : undefined;
    const camera = Object.values(streams).find((s) => s.id !== remote.screenId);
    return { ...remote, streams, screen, stream: camera };
  };

  const upsert = (id: string, patch: Partial<Remote>) =>
    set((s) => ({
      remotes: {
        ...s.remotes,
        [id]: { id, name: '', audio: true, video: true, state: 'connecting', route: 'unknown', ...s.remotes[id], ...patch },
      },
    }));

  /** Whether your camera or microphone is still working; if not, tries to open it again. */
  const ensureLive = async (kind: 'audioinput' | 'videoinput'): Promise<boolean> => {
    const track = kind === 'videoinput' ? get().local?.getVideoTracks()[0] : micRaw;
    if (track && track.readyState === 'live') return true;
    return get().selectDevice(kind, get().selected[kind], true);
  };

  /** Turns a device off and says so when it stops by itself, such as when it is unplugged. */
  const watchDevice = (track: MediaStreamTrack, kind: 'audioinput' | 'videoinput') => {
    track.addEventListener('ended', () => {
      const current = kind === 'videoinput' ? get().local?.getVideoTracks()[0] : micRaw;
      if (current !== track) return; // we replaced it ourselves
      if (kind === 'videoinput' ? get().video : get().audio) {
        set(kind === 'videoinput' ? { video: false } : { audio: false });
        broadcastState();
      }
      toast.error(kind === 'videoinput' ? COPY.toasts.cameraLost : COPY.toasts.micLost);
    });
  };

  const onEvent = (event: RoomEvent) => {
    switch (event.type) {
      case 'participant-joined':
        upsert(event.participant.id, { name: event.participant.name });
        break;
      case 'stream':
        set((s) => ({ remotes: { ...s.remotes, [event.id]: sortStreams({ ...blank(event.id), ...s.remotes[event.id] }, { [event.stream.id]: event.stream }) } }));
        break;
      case 'peer-state':
        upsert(event.id, { state: event.state });
        break;
      case 'peer-route':
        upsert(event.id, { route: event.route });
        break;
      case 'message':
        if (event.data.kind === 'state') upsert(event.id, { audio: event.data.audio, video: event.data.video });
        else if (event.data.kind === 'name') upsert(event.id, { name: event.data.name });
        else if (event.data.kind === 'screen') {
          const { streamId } = event.data;
          set((s) => {
            const current = { ...blank(event.id), ...s.remotes[event.id] };
            const streams = { ...current.streams };
            if (!streamId && current.screenId) delete streams[current.screenId];
            return { remotes: { ...s.remotes, [event.id]: sortStreams({ ...current, streams, screenId: streamId ?? undefined }, {}) } };
          });
        }
        break;
      case 'participant-left':
        set((s) => {
          const remotes = { ...s.remotes };
          delete remotes[event.id];
          return { remotes };
        });
        break;
      case 'connection':
        if (event.state === 'closed') {
          get().leave();
          set({ error: event.reason ?? 'The connection was lost.' });
        } else {
          set({ reconnecting: event.state === 'reconnecting' });
        }
        break;
    }
  };

  /** One change to the microphone path at a time, so rapid setting changes cannot start two filters. */
  const applyNoiseNow = async () => {
    const { local } = get();
    if (!local || !micRaw) return;
    const { noise, micVolume } = useSettings.getState();
    const wantNoise = noise.enabled && noiseSupported();
    // The microphone goes through our own audio path only when something needs doing to it.
    const wantProcessor = wantNoise || micVolume !== 100;
    let output = micRaw;
    if (wantProcessor) {
      try {
        if (!micProcessor || micProcessor.source !== micRaw || micProcessor.hasNoise !== wantNoise) {
          if (wantNoise) set({ noiseStatus: 'loading' });
          micProcessor?.dispose();
          micProcessor = undefined;
          micProcessor = await createMicProcessor(micRaw, { noise: wantNoise, level: noise.strength, gain: micVolume });
        } else {
          micProcessor.setLevel(noise.strength);
          micProcessor.setGain(micVolume);
        }
        output = micProcessor.track;
        set({ noiseStatus: wantNoise ? 'on' : 'off' });
      } catch {
        micProcessor = undefined;
        set({ noiseStatus: wantNoise ? 'error' : 'off' });
        toast.error(wantNoise ? COPY.toasts.noise : COPY.toasts.volume);
      }
    } else {
      micProcessor?.dispose();
      micProcessor = undefined;
      set({ noiseStatus: 'off' });
    }
    // The browser's own suppression is skipped while ours runs, so audio is not cleaned twice.
    void micRaw.applyConstraints({ noiseSuppression: !micProcessor?.hasNoise }).catch(() => {});

    const current = get().local;
    if (!current || current.getAudioTracks()[0] === output) return;
    output.enabled = get().audio;
    const stream = new MediaStream([output, ...current.getVideoTracks()]);
    set({ local: stream });
    await publish();
  };

  return {
    phase: 'lobby',
    audio: true,
    video: true,
    reconnecting: false,
    noiseStatus: 'off',
    remotes: {},
    devices: noDevices(),
    selected: loadSelection(),

    async startPreview() {
      if (get().local) return;
      try {
        const { selected } = get();
        const [audio, video] = await Promise.all([acquireTrack('audioinput', selected.audioinput), acquireTrack('videoinput', selected.videoinput)]);
        const next = { ...selected, audioinput: audio.id, videoinput: video.id };
        saveSelection(next);
        micRaw = audio.track;
        watchDevice(audio.track, 'audioinput');
        watchDevice(video.track, 'videoinput');
        set({ local: new MediaStream([audio.track, video.track]), selected: next, error: undefined });
      } catch {
        set({ error: MEDIA_DENIED_MESSAGE });
      }
      await get().refreshDevices(); // device names are only available once access is granted
    },

    applyNoise() {
      noiseQueue = noiseQueue.then(applyNoiseNow, applyNoiseNow);
      return noiseQueue;
    },

    async refreshDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = toDeviceLists(await navigator.mediaDevices.enumerateDevices());
      const selected = validSelection(get().selected, devices);
      const unplugged = (['audioinput', 'videoinput'] as const).filter((k) => selected[k] !== get().selected[k]);
      set({ devices, selected });
      saveSelection(selected);
      for (const kind of unplugged) await get().selectDevice(kind, ''); // the chosen device went away; use the default
    },

    async selectDevice(kind, id, quiet = false) {
      const selected = { ...get().selected, [kind]: id };
      if (kind === 'audiooutput') {
        saveSelection(selected);
        set({ selected });
        return true;
      }
      const { local, audio, video } = get();
      if (!local) {
        saveSelection(selected);
        set({ selected });
        return true;
      }
      try {
        const next = await acquireTrack(kind, id);
        const isVideo = kind === 'videoinput';
        next.track.enabled = isVideo ? video : audio;
        watchDevice(next.track, kind);
        const old = isVideo ? local.getVideoTracks() : local.getAudioTracks();
        const kept = isVideo ? local.getAudioTracks() : local.getVideoTracks();
        const stream = new MediaStream([...kept, next.track]);
        selected[kind] = next.id;
        saveSelection(selected);
        if (!isVideo) {
          micProcessor?.dispose(); // it was reading the old microphone
          micProcessor = undefined;
          micRaw?.stop();
          micRaw = next.track;
        }
        set({ local: stream, selected });
        old.forEach((t) => t.stop());
        if (isVideo) await effects?.restart(); // a filter or effect was drawn from the old camera
        await publish();
        if (!isVideo) await get().applyNoise();
        return true;
      } catch {
        if (!quiet) toast.error(kind === 'videoinput' ? COPY.toasts.switchCamera : COPY.toasts.switchMic);
        return false;
      }
    },

    async join(room, name) {
      const { local } = get();
      if (!local) return;
      set({ phase: 'joining', error: undefined, loginRequired: undefined, roomId: room });
      await get().applyNoise(); // the call starts with the cleaned-up microphone
      const { config } = await loadClientConfig();
      transport = new MeshTransport({
        beaconUrls: config.beaconUrls,
        clientVersion: CLIENT_VERSION,
        videoTiers: config.limits.videoTiers,
        relayVideoTier: config.limits.relayVideoTier,
        // `?ice=relay` forces every connection through a relay, to check whether a room has one.
        telemetry: (event) => telemetry.record(event),
        getAuthToken: () => useAuth.getState().token(),
        iceTransportPolicy: new URLSearchParams(location.search).get('ice') === 'relay' ? 'relay' : undefined,
      });
      unsubscribe = transport.on(onEvent);
      try {
        await transport.join(room, name, outgoing() ?? local);
        // Effects are drawn into the outgoing video only while one is showing; between them the camera is sent as is.
        effects = new EffectsController({
          camera: () => get().local,
          vision: visionSupported() ? createVision() : undefined,
          setStream: (stream) => {
            set({ localDisplay: stream === get().local ? undefined : stream });
            void publish();
          },
        });
        void effects.setFilter(useSettings.getState().moodFilter);
        void effects.setLook(lookFromSettings());
        set({ phase: 'in-call', roomAccess: transport.roomAccess });
        broadcastState();
      } catch (err) {
        transport.leave();
        unsubscribe();
        transport = undefined;
        if (err instanceof InvalidTokenError) useAuth.getState().signOut(); // the sign-in ran out; the person signs in again
        const loginRequired = err instanceof LoginRequiredError ? err.reason : err instanceof InvalidTokenError ? 'expired' : undefined;
        const known = err instanceof RoomFullError || err instanceof UpgradeRequiredError || err instanceof JoinError;
        set({ phase: 'lobby', loginRequired, error: loginRequired ? undefined : known ? err.message : 'Could not join the room.' });
      }
    },

    async toggleAudio() {
      const audio = !get().audio;
      if (audio && !(await ensureLive('audioinput'))) return toast.error(COPY.toasts.micFailed);
      get().local?.getAudioTracks().forEach((t) => (t.enabled = audio));
      set({ audio });
      broadcastState();
    },

    async setRoomAccess(signedInOnly) {
      const { roomId } = get();
      if (!roomId) return;
      try {
        const token = await useAuth.getState().token();
        const res = await fetch(new URL(`/v1/rooms/${roomId}`, getServerUrl()), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ signedInOnly }),
        });
        if (!res.ok) throw new Error(String(res.status));
        set({ roomAccess: { signedInOnly, owner: true } });
      } catch {
        toast.error(COPY.toasts.roomAccess);
      }
    },

    async shareScreen() {
      if (get().screen) return;
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
        const track = screen.getVideoTracks()[0];
        if (!track) return;
        track.contentHint = 'detail'; // keep text sharp rather than smooth
        track.addEventListener('ended', () => get().stopScreen()); // the browser's own "Stop sharing" button
        set({ screen });
        transport?.setScreenStream(screen);
        transport?.send({ kind: 'screen', streamId: screen.id });
      } catch (err) {
        // Closing the picker is not a failure. Anything else is, and the person should hear about it.
        const e = err as DOMException;
        const cancelled = e?.name === 'NotAllowedError' && !/system/i.test(e.message);
        if (!cancelled) toast.error(e?.name === 'NotAllowedError' ? COPY.toasts.screenBlocked : COPY.toasts.screenFailed);
      }
    },

    stopScreen() {
      const { screen } = get();
      if (!screen) return;
      screen.getTracks().forEach((t) => t.stop());
      set({ screen: undefined });
      transport?.setScreenStream(undefined);
      transport?.send({ kind: 'screen', streamId: null });
    },

    async toggleVideo() {
      const video = !get().video;
      if (video && !(await ensureLive('videoinput'))) return toast.error(COPY.toasts.cameraFailed);
      if (!video) effects?.end(); // nobody can see effects on a camera that is off
      get().local?.getVideoTracks().forEach((t) => (t.enabled = video));
      get().localDisplay?.getVideoTracks().forEach((t) => (t.enabled = video));
      set({ video });
      broadcastState();
    },

    async react(emoji) {
      if (!get().video) return;
      try {
        await effects?.react(emoji);
      } catch {
        toast.error(COPY.toasts.reactions);
      }
    },

    async sendGif(source, mode) {
      try {
        await effects?.showGif(source, mode);
      } catch {
        toast.error(COPY.toasts.gif);
        throw new Error('gif-failed');
      }
    },

    leave() {
      get().stopScreen();
      effects?.dispose();
      effects = undefined;
      transport?.leave();
      unsubscribe?.();
      transport = undefined;
      get().local?.getTracks().forEach((t) => t.stop());
      micProcessor?.dispose();
      micProcessor = undefined;
      micRaw?.stop();
      micRaw = undefined;
      set({ roomAccess: undefined, noiseStatus: 'off', phase: 'lobby', local: undefined, localDisplay: undefined, remotes: {}, audio: true, video: true, reconnecting: false });
    },
  };
});

// Plugging in or removing a device updates the lists, and a chosen device that vanished falls back to the default.
if (typeof navigator !== 'undefined') {
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void useCall.getState().refreshDevices());
}

// Settings that take effect during a call: the noise filter follows its toggle and strength, and a new name
// is announced to everyone.
let nameTimer: ReturnType<typeof setTimeout> | undefined;
let noiseTimer: ReturnType<typeof setTimeout> | undefined;
useSettings.subscribe((now, before) => {
  if (now.noise !== before.noise || now.micVolume !== before.micVolume) {
    clearTimeout(noiseTimer);
    noiseTimer = setTimeout(() => void useCall.getState().applyNoise(), 150);
  }
  if (now.moodFilter !== before.moodFilter) void effects?.setFilter(now.moodFilter);
  if (now.blurBackground !== before.blurBackground || now.autoFrame !== before.autoFrame) void effects?.setLook(lookFromSettings());
  if (now.name !== before.name) {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      const name = now.name.trim();
      if (name && useCall.getState().phase === 'in-call') transport?.send({ kind: 'name', name });
    }, 400);
  }
});
