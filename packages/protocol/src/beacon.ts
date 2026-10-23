import { z } from 'zod';
import { PROTOCOL_VERSION } from './version';

export const IceServer = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof IceServer>;

export const Tier = z.enum(['free', 'relay-lite', 'full']);
export type Tier = z.infer<typeof Tier>;

/** What the server remembers about a room while it is in use. */
export const RoomRecord = z.object({
  /** The account that made the room; absent when a guest did. Only the owner can change the room's access. */
  owner: z.string().optional(),
  /** When true, only people who are signed in may join. */
  signedInOnly: z.boolean(),
  /** When true, only people who were already in the room (and its owner) can join: no new faces. */
  locked: z.boolean().default(false),
  createdAt: z.number().int(),
});
export type RoomRecord = z.infer<typeof RoomRecord>;

/** Anyone can ask for a signed-in-only room; only a signed-in owner can change it afterwards. */
export const CreateRoomRequest = z.object({ signedInOnly: z.boolean().optional() });
export type CreateRoomRequest = z.infer<typeof CreateRoomRequest>;

export const CreateRoomResponse = z.object({ room: z.string(), signedInOnly: z.boolean() });
export type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;

export const UpdateRoomRequest = z
  .object({ signedInOnly: z.boolean().optional(), locked: z.boolean().optional() })
  .refine((v) => v.signedInOnly !== undefined || v.locked !== undefined, 'Nothing to change.');
export type UpdateRoomRequest = z.infer<typeof UpdateRoomRequest>;

/** Error codes the beacon uses when the person has to sign in first, so clients can offer a sign-in. */
export const LOGIN_REQUIRED_TO_CREATE = 'login-required-to-create';
export const LOGIN_REQUIRED_TO_JOIN = 'login-required-to-join';
/** The token sent with the request was not accepted (expired, wrong audience, not from the trusted provider). */
export const INVALID_TOKEN = 'invalid-token';
/** The room's owner locked it, and this person was not already in it. */
export const ROOM_LOCKED = 'room-locked';

export const JoinRequest = z.object({
  room: z.string(),
  clientVersion: z.string().default('0.0.0'),
  protocol: z.number().int().default(PROTOCOL_VERSION),
  /** Token from an earlier join, so a reconnecting client keeps its peer id. */
  resume: z.string().optional(),
  /** Reserved for a future billing service; ignored while everyone is on the free tier. */
  entitlement: z.string().optional(),
});
export type JoinRequest = z.input<typeof JoinRequest>;

export const JoinResponse = z.object({
  signalingUrl: z.string(),
  joinToken: z.string(),
  resumeToken: z.string(),
  peerId: z.string(),
  iceServers: z.array(IceServer),
  transport: z.enum(['mesh', 'sfu']),
  tier: Tier,
  /** The room's access rules as the beacon holds them, and whether this person owns the room. */
  room: z.object({ signedInOnly: z.boolean(), owner: z.boolean(), locked: z.boolean().default(false) }).optional(),
});
export type JoinResponse = z.infer<typeof JoinResponse>;

export const BeaconError = z.object({ error: z.string(), code: z.string().optional() });
