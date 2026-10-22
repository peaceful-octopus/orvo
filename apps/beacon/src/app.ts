import {
  DEFAULT_VIDEO_TIERS,
  MAX_ROOM_SIZE,
  WARN_ROOM_SIZE,
  JoinRequest,
  generateRoomId,
  isClientSupported,
  isValidRoomSlug,
  randomId,
  signConfig,
  signJoinToken,
  signResumeToken,
  toBase64Url,
  verifyResumeToken,
  type ClientConfig,
  type IceServer,
  type JoinResponse,
  type Tier,
  type VideoTierRule,
} from '@chillcall/protocol';
import { NoNodesError, placeRoom, type NodeInfo, type PlacementStore } from '@chillcall/placement';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { SigningKey } from './keys';
import { turnCredentials, type TurnPool } from './turn';

/**
 * Decides what an entitlement token grants for a room. It is the seam for a future billing service:
 * return `relay-lite` or `full` for a valid token, `undefined` otherwise. Without a verifier every room is free.
 */
export type EntitlementVerifier = (token: string, room: string) => Promise<Exclude<Tier, 'free'> | undefined>;

export interface BeaconOptions {
  signingKey: SigningKey;
  store: PlacementStore;
  stunUrls: string[];
  /** TURN pools by tier. Only entitled rooms receive credentials for them; `free` rooms get STUN only. */
  turn?: { 'relay-lite'?: TurnPool; full?: TurnPool };
  entitlements?: EntitlementVerifier;
  /** Public WebSocket URL for a node. Defaults to the node's own `url`, else the request's host (single container). */
  nodeUrl?: (node: NodeInfo, req: FastifyRequest) => string;
  minClientVersion?: string;
  /** Room limits published in the signed config and enforced by nodes through the join token. */
  limits?: { maxRoomSize?: number; warnRoomSize?: number; videoTiers?: VideoTierRule[] };
  /** A notice shown to every client, for example about maintenance. */
  announcement?: { id: string; text: string };
  /** A pre-signed config (for example produced by `tools/sign-config`) served as is instead of a generated one. */
  staticConfig?: unknown;
  now?: () => number;
  corsOrigin?: string | boolean;
  /** Requests per minute per client IP; `false` disables limiting. */
  rateLimitPerMinute?: number | false;
  trustProxy?: boolean;
}

const JOIN_TOKEN_TTL_MS = 60_000;
const RESUME_TOKEN_TTL_MS = 15 * 60_000;
const ROOM_TIER_TTL_MS = 3600_000;
const CONFIG_TTL_MS = 3600_000;

const TIER_RANK: Record<Tier, number> = { free: 0, 'relay-lite': 1, full: 2 };

function requestOrigin(req: FastifyRequest): string {
  return `${req.protocol}://${req.headers.host}`;
}

export async function createBeaconApp(opts: BeaconOptions): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const { kid, secretKey, publicKey } = opts.signingKey;
  const app = Fastify({ trustProxy: opts.trustProxy ?? false });
  const maxRoomSize = opts.limits?.maxRoomSize ?? MAX_ROOM_SIZE;
  const warnRoomSize = opts.limits?.warnRoomSize ?? WARN_ROOM_SIZE;

  await app.register(cors, { origin: opts.corsOrigin ?? true });
  // Limits apply only to the API routes below, not to static files served by the all-in-one server.
  await app.register(rateLimit, { global: false });
  const limited =
    opts.rateLimitPerMinute === false
      ? {}
      : { config: { rateLimit: { max: opts.rateLimitPerMinute ?? 120, timeWindow: '1 minute' } } };

  app.get('/healthz', async () => 'ok');

  app.get('/v1/keys', async () => ({ [kid]: toBase64Url(publicKey) }));

  app.get('/v1/config', limited, async (req, reply) => {
    if (opts.staticConfig) return reply.header('cache-control', 'max-age=60').send(opts.staticConfig);
    const t = now();
    const config: ClientConfig = {
      version: Math.floor(t / 1000),
      issuedAt: t,
      validUntil: t + CONFIG_TTL_MS,
      minClientVersion: opts.minClientVersion ?? '0.0.0',
      minProtocol: 1,
      beaconUrls: [requestOrigin(req)],
      limits: {
        maxRoomSize,
        warnRoomSize,
        videoTiers: opts.limits?.videoTiers ?? DEFAULT_VIDEO_TIERS,
      },
      features: {},
      ice: { stunUrls: opts.stunUrls },
      regions: [{ id: 'default', name: 'Default' }],
      announcement: opts.announcement,
    };
    return reply.header('cache-control', 'max-age=60').send(signConfig(config, kid, secretKey));
  });

  app.post('/v1/rooms', limited, async () => ({ room: generateRoomId() }));

  /** The room's tier: the best of what it already has and what this joiner's entitlement grants. */
  async function tierFor(room: string, entitlement: string | undefined): Promise<Tier> {
    let tier: Tier = (await opts.store.getRoomTier(room)) ?? 'free';
    if (entitlement && opts.entitlements) {
      const granted = await opts.entitlements(entitlement, room);
      if (granted && TIER_RANK[granted] > TIER_RANK[tier]) tier = granted;
    }
    // Entitled rooms stay entitled for everyone in them, and the grant is refreshed while people keep joining.
    if (tier !== 'free') await opts.store.setRoomTier(room, tier, ROOM_TIER_TTL_MS);
    return tier;
  }

  app.post('/v1/rooms/join', limited, async (req, reply) => {
    const parsed = JoinRequest.safeParse(req.body);
    if (!parsed.success || !isValidRoomSlug(parsed.data.room)) {
      return reply.code(400).send({ error: 'Invalid join request.', code: 'bad-request' });
    }
    const body = parsed.data;
    const supported = isClientSupported(
      { version: body.clientVersion, protocol: body.protocol },
      { minClientVersion: opts.minClientVersion ?? '0.0.0', minProtocol: 1 },
    );
    if (!supported) return reply.code(426).send({ error: 'Please update ChillCall.', code: 'upgrade-required' });

    let node: NodeInfo;
    try {
      node = await placeRoom(opts.store, body.room);
    } catch (err) {
      if (err instanceof NoNodesError) return reply.code(503).send({ error: err.message, code: 'no-nodes' });
      throw err;
    }

    const t = now();
    const resumed = body.resume
      ? verifyResumeToken(body.resume, { keys: { [kid]: publicKey }, now: t, room: body.room })
      : null;
    const peerId = resumed?.peerId ?? `p${randomId(6)}`;
    const url = opts.nodeUrl?.(node, req) ?? node.url ?? requestOrigin(req).replace(/^http/, 'ws') + '/ws';

    const tier = await tierFor(body.room, body.entitlement);
    const iceServers: IceServer[] = opts.stunUrls.length ? [{ urls: opts.stunUrls }] : [];
    const pool = tier === 'free' ? undefined : opts.turn?.[tier];
    if (pool) iceServers.push(turnCredentials(pool, peerId, t));

    const response: JoinResponse = {
      signalingUrl: url,
      joinToken: signJoinToken(
        { room: body.room, nodeId: node.id, peerId, exp: t + JOIN_TOKEN_TTL_MS, nonce: randomId(12), maxRoomSize },
        kid,
        secretKey,
      ),
      resumeToken: signResumeToken({ room: body.room, peerId, exp: t + RESUME_TOKEN_TTL_MS }, kid, secretKey),
      peerId,
      iceServers,
      transport: 'mesh',
      tier,
    };
    return response;
  });

  return app;
}
