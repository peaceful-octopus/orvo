import type { ActivityDataMessages } from '@orvo/protocol';

/** The activity running in the call, as announced by the person who started it. */
export interface RunningActivity {
  instanceId: string;
  activityId: string;
  /** Who started it. They run it, so it ends when they leave or close it. */
  starter: string;
}

export interface ActivityRoom {
  current?: RunningActivity;
  /**
   * What each participant last said they have open (an instance id, or null for none). Kept even before the activity
   * itself is known, because the messages of different peers can arrive in any order.
   */
  presence: Record<string, string | null>;
}

export const emptyRoom = (): ActivityRoom => ({ presence: {} });

/** Applies an activity message from another participant. */
export function receive(room: ActivityRoom, from: string, message: ActivityDataMessages): ActivityRoom {
  if (message.kind === 'activity-presence') {
    if (room.presence[from] === message.instanceId) return room;
    return { ...room, presence: { ...room.presence, [from]: message.instanceId } };
  }
  if (message.kind !== 'activity') return room;

  const { current } = room;
  if (message.instanceId === null) {
    return current && current.starter === from ? { ...room, current: undefined } : room;
  }
  if (message.activityId === undefined || current?.instanceId === message.instanceId) return room;
  // Two people starting at once: everyone picks the same one, the smaller instance id, so nobody is left in a different game.
  if (current && current.starter !== from && current.instanceId < message.instanceId) return room;
  return { ...room, current: { instanceId: message.instanceId, activityId: message.activityId, starter: from } };
}

/** Someone left the call. If they started the activity, it is over. */
export function peerLeft(room: ActivityRoom, id: string): ActivityRoom {
  const presence = { ...room.presence };
  delete presence[id];
  return { presence, current: room.current?.starter === id ? undefined : room.current };
}

/** You started an activity. */
export function started(room: ActivityRoom, self: string, instanceId: string, activityId: string): ActivityRoom {
  return { ...room, current: { instanceId, activityId, starter: self } };
}

/** The activity ended, from your side. */
export function ended(room: ActivityRoom): ActivityRoom {
  return { ...room, current: undefined };
}

/** You opened or closed the activity. */
export function setPresence(room: ActivityRoom, self: string, instanceId: string | null): ActivityRoom {
  return room.presence[self] === instanceId ? room : { ...room, presence: { ...room.presence, [self]: instanceId } };
}

/** The people who have the current activity open, in a stable order. */
export function participantsOf(room: ActivityRoom): string[] {
  const { current } = room;
  if (!current) return [];
  return Object.keys(room.presence)
    .filter((id) => room.presence[id] === current.instanceId)
    .sort();
}
