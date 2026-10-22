import { MeshTransport, RoomFullError, type RoomEvent } from '@chillcall/rtc';
import { create } from 'zustand';
import { SIGNALING_URL } from './config';

export interface Remote {
  id: string;
  name: string;
  stream?: MediaStream;
  audio: boolean;
  video: boolean;
}

type Phase = 'lobby' | 'joining' | 'in-call';

interface CallState {
  phase: Phase;
  error?: string;
  local?: MediaStream;
  audio: boolean;
  video: boolean;
  remotes: Record<string, Remote>;
  startPreview(): Promise<void>;
  join(room: string, name: string): Promise<void>;
  toggleAudio(): void;
  toggleVideo(): void;
  leave(): void;
}

type StateMessage = { kind: 'state'; audio: boolean; video: boolean };

let transport: MeshTransport | undefined;
let unsubscribe: (() => void) | undefined;

export const useCall = create<CallState>((set, get) => {
  const broadcastState = () => {
    const { audio, video } = get();
    transport?.send({ kind: 'state', audio, video } satisfies StateMessage);
  };

  const upsert = (id: string, patch: Partial<Remote>) =>
    set((s) => ({
      remotes: {
        ...s.remotes,
        [id]: { id, name: '', audio: true, video: true, ...s.remotes[id], ...patch },
      },
    }));

  const onEvent = (event: RoomEvent) => {
    switch (event.type) {
      case 'participant-joined':
        upsert(event.participant.id, { name: event.participant.name });
        broadcastState();
        break;
      case 'stream':
        upsert(event.id, { stream: event.stream });
        break;
      case 'message': {
        const msg = event.data as StateMessage;
        if (msg.kind === 'state') upsert(event.id, { audio: msg.audio, video: msg.video });
        break;
      }
      case 'participant-left':
        set((s) => {
          const remotes = { ...s.remotes };
          delete remotes[event.id];
          return { remotes };
        });
        break;
    }
  };

  return {
    phase: 'lobby',
    audio: true,
    video: true,
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
      transport = new MeshTransport(SIGNALING_URL);
      unsubscribe = transport.on(onEvent);
      try {
        await transport.join(room, name, local);
        set({ phase: 'in-call' });
      } catch (err) {
        transport.leave();
        unsubscribe();
        transport = undefined;
        set({
          phase: 'lobby',
          error: err instanceof RoomFullError ? err.message : 'Could not join the room. Is the signaling server running?',
        });
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
      get().local?.getVideoTracks().forEach((t) => (t.enabled = video));
      set({ video });
      broadcastState();
    },

    leave() {
      transport?.leave();
      unsubscribe?.();
      transport = undefined;
      get().local?.getTracks().forEach((t) => t.stop());
      set({ phase: 'lobby', local: undefined, remotes: {}, audio: true, video: true });
    },
  };
});
