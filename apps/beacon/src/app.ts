import {
  DEFAULT_VIDEO_TIERS,
  MAX_ROOM_SIZE,
  WARN_ROOM_SIZE,
  JoinRequest,
  TelemetryBatch,
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
import { LATENCY_BUCKETS, Metrics } from '@chillcall/metrics';
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
  /** Public keys (key id to base64url) of earlier signing keys, still published so key rotation needs no downtime. */
  previousPublicKeys?: Record<string, string>;
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
  /** Share a metrics registry with other components in the process; one is created when omitted. */
  metrics?: Metrics;
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

  // sendBeacon with a text/plain body avoids a CORS preflight, which a closing page cannot wait for.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Body is not JSON.'), { statusCode: 400 }), undefined);
    }
  });

  const metrics = opts.metrics ?? new Metrics();
  const m = {
    joins: metrics.counter('chillcall_beacon_join_requests_total', 'Join requests, by outcome.', ['result'] as const),
    joinSeconds: metrics.histogram('chillcall_beacon_join_duration_seconds', 'Time to answer a join request.', LATENCY_BUCKETS),
    tiers: metrics.counter('chillcall_beacon_joins_by_tier_total', 'Successful joins, by room tier.', ['tier'] as const),
    rooms: metrics.counter('chillcall_beacon_rooms_created_total', 'Rooms created.'),
    versions: metrics.counter('chillcall_beacon_joins_by_client_version_total', 'Successful joins, by client version (bounded; extras are "other").', ['version'] as const),
    configs: metrics.counter('chillcall_beacon_config_requests_total', 'Config requests served.'),
  };
  // What clients report about their own connections, aggregated here and never stored per user.
  const client = {
    joins: metrics.counter('chillcall_client_joins_total', 'Client-reported room joins, by result.', ['result'] as const),
    joinSeconds: metrics.histogram('chillcall_client_join_seconds', 'Client-measured time to join a room.', LATENCY_BUCKETS),
    peers: metrics.counter('chillcall_client_peer_connections_total', 'Client-reported peer connections, by result and route.', ['result', 'route'] as const),
    peerSeconds: metrics.histogram('chillcall_client_peer_connect_seconds', 'Client-measured time to connect to a peer.', LATENCY_BUCKETS, ['route'] as const),
    reconnects: metrics.counter('chillcall_client_signaling_reconnects_total', 'Signaling reconnections, by outcome.', ['ok'] as const),
  };
  metrics.gauge('chillcall_beacon_nodes', 'Signaling nodes currently registered.', async () => (await opts.store.listNodes()).length);
  metrics.gauge('chillcall_beacon_placement_degraded', '1 while the shared placement store is unreachable and answers come from memory.', () =>
    (opts.store as { degraded?: boolean }).degraded ? 1 : 0,
  );
  metrics.gauge('chillcall_beacon_nodes_draining', 'Registered signaling nodes that are draining.', async () =>
    (await opts.store.listNodes()).filter((n) => n.draining).length,
  );

  // Client versions come from untrusted input, so only a limited number of well-formed ones become label values.
  const seenVersions = new Set<string>();
  const versionLabel = (version: string) => {
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) return 'other';
    if (!seenVersions.has(version) && seenVersions.size >= 50) return 'other';
    seenVersions.add(version);
    return version;
  };

  await app.register(cors, { origin: opts.corsOrigin ?? true });
  // Limits apply only to the API routes below, not to static files served by the all-in-one server.
  await app.register(rateLimit, { global: false });
  const limited =
    opts.rateLimitPerMinute === false
      ? {}
      : { config: { rateLimit: { max: opts.rateLimitPerMinute ?? 120, timeWindow: '1 minute' } } };

  app.get('/healthz', async () => 'ok');

  app.get('/metrics', async (_req, reply) => reply.type(metrics.contentType).send(await metrics.render()));

  app.get('/v1/keys', async () => ({ ...opts.previousPublicKeys, [kid]: toBase64Url(publicKey) }));

  app.get('/v1/config', limited, async (req, reply) => {
    m.configs.inc();
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

  app.post('/v1/telemetry', { ...limited, bodyLimit: 8 * 1024 }, async (req, reply) => {
    const parsed = TelemetryBatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid telemetry.', code: 'bad-request' });
    for (const event of parsed.data.events) {
      if (event.type === 'join') {
        client.joins.inc({ result: event.result });
        client.joinSeconds.observe(event.ms / 1000);
      } else if (event.type === 'peer') {
        client.peers.inc({ result: event.result, route: event.route });
        if (event.result === 'connected') client.peerSeconds.observe({ route: event.route }, event.ms / 1000);
      } else {
        client.reconnects.inc({ ok: String(event.ok) });
      }
    }
    return reply.code(204).send();
  });

  app.post('/v1/rooms', limited, async () => {
    m.rooms.inc();
    return { room: generateRoomId() };
  });

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
    const stop = m.joinSeconds.startTimer();
    const done = (result: string) => {
      m.joins.inc({ result });
      stop();
    };
    const parsed = JoinRequest.safeParse(req.body);
    if (!parsed.success || !isValidRoomSlug(parsed.data.room)) {
      done('bad-request');
      return reply.code(400).send({ error: 'Invalid join request.', code: 'bad-request' });
    }
    const body = parsed.data;
    const supported = isClientSupported(
      { version: body.clientVersion, protocol: body.protocol },
      { minClientVersion: opts.minClientVersion ?? '0.0.0', minProtocol: 1 },
    );
    if (!supported) {
      done('upgrade-required');
      return reply.code(426).send({ error: 'Please update ChillCall.', code: 'upgrade-required' });
    }

    let node: NodeInfo;
    try {
      node = await placeRoom(opts.store, body.room);
    } catch (err) {
      if (err instanceof NoNodesError) {
        done('no-nodes');
        return reply.code(503).send({ error: err.message, code: 'no-nodes' });
      }
      done('error');
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
    done('ok');
    m.tiers.inc({ tier });
    m.versions.inc({ version: versionLabel(body.clientVersion) });
    return response;
  });

  return app;
}
