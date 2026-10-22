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
  /** Whether the connection to the signaling server is up; calls continue while it reconnects. */
  reconnecting: boolean;
  remotes: Record<string, Remote>;
  startPreview(): Promise<void>;
  join(room: string, name: string): Promise<void>;
  toggleAudio(): void;
  toggleVideo(): void;
  react(emoji: string): Promise<void>;
  sendGif(source: GifSource, mode: GifMode): Promise<void>;
  leave(): void;
}

let transport: MeshTransport | undefined;
let unsubscribe: (() => void) | undefined;
let effects: EffectsController | undefined;
let messageTimer: ReturnType<typeof setTimeout> | undefined;

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

  return {
    phase: 'lobby',
    audio: true,
    video: true,
    reconnecting: false,
    remotes: {},

    async startPreview() {
      if (get().local) return;
      try {
        const local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        set({ local, error: undefined });
      } catch {
        set({ error: 'Camera or microphone access was denied.' });
      }
    },

    async join(room, name) {
      const { local } = get();
      if (!local) return;
      set({ phase: 'joining', error: undefined });
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
        await transport.join(room, name, local);
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
      set({ phase: 'lobby', local: undefined, localDisplay: undefined, remotes: {}, audio: true, video: true, reconnecting: false });
    },
  };
});
