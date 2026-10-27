import { z } from 'zod';
import { MAX_ROOM_SIZE } from './limits';
import { MAX_NAME_LENGTH } from './signaling';

/** Version of the host API between the app and an activity running in an iframe. */
export const ACTIVITY_API_VERSION = 1;

/** Largest JSON payload (in bytes) a single activity message may carry. */
export const MAX_ACTIVITY_DATA_BYTES = 8 * 1024;

/** Messages per second the app accepts from one participant for one activity instance. */
export const MAX_ACTIVITY_MESSAGES_PER_SECOND = 60;

const activityId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const instanceId = z.string().min(1).max(64);
const peerId = z.string().min(1).max(200);

/** An activity the server offers. Clients learn about it from the signed config. */
export const ActivityManifest = z
  .object({
    id: activityId,
    name: z.string().min(1).max(40),
    description: z.string().max(200),
    version: z.string().min(1).max(20),
    /** Host API version the activity was written for. Clients skip versions they do not implement. */
    apiVersion: z.number().int().positive(),
    /** Path on the server's own origin; the page is loaded in a sandboxed iframe. */
    entry: z
      .string()
      .max(200)
      .startsWith('/activities/')
      .refine((path) => !path.includes('..') && !path.includes('//') && !path.includes('\\')),
    icon: z.string().max(16).optional(),
    minPlayers: z.number().int().positive(),
    maxPlayers: z.number().int().positive().max(MAX_ROOM_SIZE),
    /** Extra host abilities the activity asks for. None exist in API version 1. */
    capabilities: z.array(z.string().max(32)).max(8),
  })
  .refine((manifest) => manifest.minPlayers <= manifest.maxPlayers);
export type ActivityManifest = z.infer<typeof ActivityManifest>;

/** True when `data` serializes to JSON within the per-message limit. */
export function activityDataFits(data: unknown): boolean {
  try {
    const json = JSON.stringify(data);
    return json !== undefined && new TextEncoder().encode(json).length <= MAX_ACTIVITY_DATA_BYTES;
  } catch {
    return false;
  }
}

/** Data-channel messages (see datachannel.ts for how they are carried). */

/** Sent by whoever starts an activity (the host), or with a null instance to end it. Replayed to late joiners. */
export const activityMessage = z
  .object({ kind: z.literal('activity'), instanceId: instanceId.nullable(), activityId: activityId.optional() })
  .refine((message) => message.instanceId === null || message.activityId !== undefined);

/** Whether the sender currently has the activity open. Replayed to late joiners. */
export const activityPresenceMessage = z.object({ kind: z.literal('activity-presence'), instanceId: instanceId.nullable() });

/** Traffic between running activities. Never replayed. `to` limits who acts on it; it is routing, not privacy. */
export const activityDataMessage = z.object({
  kind: z.literal('activity-msg'),
  instanceId,
  to: peerId.optional(),
  data: z.unknown().refine(activityDataFits),
});

export type ActivityDataMessages =
  | { kind: 'activity'; instanceId: string | null; activityId?: string }
  | { kind: 'activity-presence'; instanceId: string | null }
  | { kind: 'activity-msg'; instanceId: string; to?: string; data: unknown };

/** Host API: postMessage between the app and the activity's iframe. */

const participant = z.object({ id: peerId, name: z.string().max(MAX_NAME_LENGTH) });
export type ActivityParticipant = z.infer<typeof participant>;

const envelope = { orvo: z.literal(ACTIVITY_API_VERSION) };

/** From the app to the activity. */
export const ActivityHostMessage = z.discriminatedUnion('type', [
  z.object({
    ...envelope,
    type: z.literal('init'),
    apiVersion: z.number().int(),
    instanceId,
    self: participant,
    host: peerId,
    isHost: z.boolean(),
    participants: z.array(participant).max(MAX_ROOM_SIZE),
    /** CSS custom properties of the app theme, so the activity can match it. */
    theme: z.record(z.string(), z.string()),
    capabilities: z.array(z.string()),
  }),
  z.object({ ...envelope, type: z.literal('participant-joined'), participant }),
  z.object({ ...envelope, type: z.literal('participant-left'), id: peerId }),
  z.object({ ...envelope, type: z.literal('message'), from: peerId, data: z.unknown() }),
  z.object({ ...envelope, type: z.literal('close') }),
]);
export type ActivityHostMessage = z.infer<typeof ActivityHostMessage>;

/** From the activity to the app. */
export const ActivityGuestMessage = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('ready') }),
  z.object({ ...envelope, type: z.literal('send'), to: peerId.optional(), data: z.unknown().refine(activityDataFits) }),
  /** Only the host may end the activity for everyone. */
  z.object({ ...envelope, type: z.literal('end') }),
]);
export type ActivityGuestMessage = z.infer<typeof ActivityGuestMessage>;

/** Parses a message from an activity iframe; null for anything that is not a valid guest message. */
export function parseGuestMessage(raw: unknown): ActivityGuestMessage | null {
  const result = ActivityGuestMessage.safeParse(raw);
  return result.success ? result.data : null;
}
