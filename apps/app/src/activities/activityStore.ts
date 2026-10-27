import type { ActivityDataMessages } from '@orvo/protocol';
import { create } from 'zustand';
import { emptyRoom, ended, peerLeft, receive, setPresence, started, type ActivityRoom } from './activityRoom';

interface ActivityState {
  room: ActivityRoom;
  /** Your id in the call, once you are in it. */
  selfId?: string;
  /** The instance whose frame you have open. It shows only while it is also the running one. */
  openInstance?: string;
  /** Starts an activity and opens it. Only one runs at a time. */
  start(activityId: string): void;
  /** Opens the running activity. */
  open(): void;
  /** Closes your frame. As the starter, this also ends the activity for everyone. */
  close(): void;
  /** Says whether your frame is up, so the others know to include you. */
  announce(open: boolean): void;
  receive(from: string, message: ActivityDataMessages): void;
  peerLeft(id: string): void;
  /** Connects to a call: `send` carries messages to the other participants. */
  bind(selfId: string, send: (message: ActivityDataMessages) => void): void;
  unbind(): void;
}

let send: (message: ActivityDataMessages) => void = () => {};
const dataListeners = new Set<(from: string, message: ActivityDataMessages) => void>();

/** Listens for messages that running activities send each other. Returns a function that stops listening. */
export function onActivityData(listener: (from: string, message: ActivityDataMessages) => void): () => void {
  dataListeners.add(listener);
  return () => void dataListeners.delete(listener);
}

export const useActivity = create<ActivityState>((set, get) => ({
  room: emptyRoom(),

  start(activityId) {
    const { selfId, room } = get();
    if (!selfId || room.current) return;
    const instanceId = crypto.randomUUID();
    set({ room: started(room, selfId, instanceId, activityId), openInstance: instanceId });
    send({ kind: 'activity', instanceId, activityId });
  },

  open() {
    const instanceId = get().room.current?.instanceId;
    if (instanceId) set({ openInstance: instanceId });
  },

  close() {
    const { room, selfId, openInstance } = get();
    if (!room.current) return;
    if (room.current.starter === selfId) {
      send({ kind: 'activity', instanceId: null });
      set({ room: ended(room), openInstance: undefined });
    } else if (openInstance === room.current.instanceId) {
      set({ openInstance: undefined });
    }
    get().announce(false);
  },

  announce(open) {
    const { room, selfId } = get();
    if (!selfId) return;
    const instanceId = open ? (room.current?.instanceId ?? null) : null;
    set({ room: setPresence(room, selfId, instanceId) });
    send({ kind: 'activity-presence', instanceId });
  },

  receive(from, message) {
    if (message.kind === 'activity-msg') {
      for (const listener of dataListeners) listener(from, message);
      return;
    }
    set({ room: receive(get().room, from, message) });
  },

  peerLeft(id) {
    set({ room: peerLeft(get().room, id) });
  },

  bind(selfId, sender) {
    send = sender;
    set({ selfId });
  },

  unbind() {
    send = () => {};
    set({ room: emptyRoom(), selfId: undefined, openInstance: undefined });
  },
}));

/** The running activity's instance id while your frame is open, else undefined. */
export const openActivityInstance = (s: ActivityState): string | undefined =>
  s.room.current && s.openInstance === s.room.current.instanceId ? s.room.current.instanceId : undefined;
