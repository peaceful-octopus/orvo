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

export const CreateRoomResponse = z.object({ room: z.string() });

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
});
export type JoinResponse = z.infer<typeof JoinResponse>;

export const BeaconError = z.object({ error: z.string(), code: z.string().optional() });
