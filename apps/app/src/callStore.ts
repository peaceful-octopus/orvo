import { EffectsController, type GifMode, type GifSource } from '@chillcall/effects';
import {
  JoinError,
  MeshTransport,
  RoomFullError,
  UpgradeRequiredError,
  type PeerRoute,
  type PeerState,
  type RoomEvent,
} from '@chillcall/rtc';
import { create } from 'zustand';
import { CLIENT_VERSION, loadClientConfig } from './config';
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
import { useSettings } from './settingsStore';
import { MEDIA_DENIED_MESSAGE } from './copy';
import { telemetry } from './telemetry';

export interface Remote {
  id: string;
  name: string;
  stream?: MediaStream;
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
  /** A short message about reactions or GIFs, such as a GIF that failed to load. */
  effectsMessage?: string;
  audio: boolean;
  video: boolean;
  /** The cameras, microphones and speakers the system offers, and which of them are chosen. */
  devices: DeviceLists;
  selected: DeviceSelection;
  /** Whether background noise suppression is running on your microphone. */
  noiseStatus: 'off' | 'loading' | 'on' | 'error';
  /** Whether the connection to the signaling server is up; calls continue while it reconnects. */
  reconnecting: boolean;
  remotes: Record<string, Remote>;
  startPreview(): Promise<void>;
  join(room: string, name: string): Promise<void>;
  toggleAudio(): void;
  toggleVideo(): void;
  applyNoise(): Promise<void>;
  refreshDevices(): Promise<void>;
  selectDevice(kind: DeviceKind, id: string): Promise<void>;
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
let messageTimer: ReturnType<typeof setTimeout> | undefined;

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

export const useCall = create<CallState>((set, get) => {
  const broadcastState = () => {
    const { audio, video } = get();
    transport?.send({ kind: 'state', audio, video });
  };

  const upsert = (id: string, patch: Partial<Remote>) =>
    set((s) => ({
      remotes: {
        ...s.remotes,
        [id]: { id, name: '', audio: true, video: true, state: 'connecting', route: 'unknown', ...s.remotes[id], ...patch },
      },
    }));

  const showEffectsMessage = (message: string) => {
    set({ effectsMessage: message });
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => set({ effectsMessage: undefined }), 4000);
  };

  const onEvent = (event: RoomEvent) => {
    switch (event.type) {
      case 'participant-joined':
        upsert(event.participant.id, { name: event.participant.name });
        break;
      case 'stream':
        upsert(event.id, { stream: event.stream });
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
        showEffectsMessage(
          wantNoise
            ? 'Noise suppression could not start, so your microphone is sent as it is.'
            : 'The microphone volume could not be applied.',
        );
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
    await transport?.replaceLocalStream(stream);
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

    async selectDevice(kind, id) {
      const selected = { ...get().selected, [kind]: id };
      if (kind === 'audiooutput') {
        saveSelection(selected);
        set({ selected });
        return;
      }
      const { local, audio, video } = get();
      if (!local) {
        saveSelection(selected);
        set({ selected });
        return;
      }
      try {
        const next = await acquireTrack(kind, id);
        const isVideo = kind === 'videoinput';
        if (isVideo) effects?.end(); // an effect is drawn on the old camera
        next.track.enabled = isVideo ? video : audio;
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
        set({ local: stream, selected, localDisplay: undefined });
        old.forEach((t) => t.stop());
        await transport?.replaceLocalStream(stream);
        if (!isVideo) await get().applyNoise();
      } catch {
        showEffectsMessage(`Could not switch to that ${kind === 'videoinput' ? 'camera' : 'microphone'}.`);
      }
    },

    async join(room, name) {
      const { local } = get();
      if (!local) return;
      set({ phase: 'joining', error: undefined });
      await get().applyNoise(); // the call starts with the cleaned-up microphone
      const { config } = await loadClientConfig();
      transport = new MeshTransport({
        beaconUrls: config.beaconUrls,
        clientVersion: CLIENT_VERSION,
        videoTiers: config.limits.videoTiers,
        relayVideoTier: config.limits.relayVideoTier,
        // `?ice=relay` forces every connection through a relay, to check whether a room has one.
        telemetry: (event) => telemetry.record(event),
        iceTransportPolicy: new URLSearchParams(location.search).get('ice') === 'relay' ? 'relay' : undefined,
      });
      unsubscribe = transport.on(onEvent);
      try {
        await transport.join(room, name, get().local ?? local);
        // Effects are drawn into the outgoing video only while one is showing; between them the camera is sent as is.
        effects = new EffectsController({
          camera: () => get().local,
          setStream: (stream) => {
            void transport?.replaceLocalStream(stream);
            set({ localDisplay: stream === get().local ? undefined : stream });
          },
        });
        set({ phase: 'in-call' });
        broadcastState();
      } catch (err) {
        transport.leave();
        unsubscribe();
        transport = undefined;
        const known = err instanceof RoomFullError || err instanceof UpgradeRequiredError || err instanceof JoinError;
        set({ phase: 'lobby', error: known ? err.message : 'Could not join the room.' });
      }
    },

    toggleAudio() {
      const audio = !get().audio;
      get().local?.getAudioTracks().forEach((t) => (t.enabled = audio));
      set({ audio });
      broadcastState();
    },

    toggleVideo() {
      const video = !get().video;
      if (!video) effects?.end(); // nobody can see effects on a camera that is off
      get().local?.getVideoTracks().forEach((t) => (t.enabled = video));
      set({ video });
      broadcastState();
    },

    async react(emoji) {
      if (!get().video) return;
      try {
        await effects?.react(emoji);
      } catch {
        showEffectsMessage('Reactions are not available right now.');
      }
    },

    async sendGif(source, mode) {
      try {
        await effects?.showGif(source, mode);
      } catch {
        showEffectsMessage('That GIF could not be loaded. Try another one.');
        throw new Error('gif-failed');
      }
    },

    leave() {
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
      set({ noiseStatus: 'off', phase: 'lobby', local: undefined, localDisplay: undefined, remotes: {}, audio: true, video: true, reconnecting: false });
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
  if (now.name !== before.name) {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      const name = now.name.trim();
      if (name && useCall.getState().phase === 'in-call') transport?.send({ kind: 'name', name });
    }, 400);
  }
});
