import {
  DEFAULT_VIDEO_TIERS,
  MAX_ROOM_SIZE,
  WARN_ROOM_SIZE,
  CreateRoomRequest,
  INVALID_TOKEN,
  JoinRequest,
  LOGIN_REQUIRED_TO_CREATE,
  LOGIN_REQUIRED_TO_JOIN,
  ROOM_LOCKED,
  TelemetryBatch,
  UpdateRoomRequest,
  generateRoomId,
  isClientSupported,
  isValidRoomSlug,
  randomId,
  signConfig,
  signJoinToken,
  signResumeToken,
  toBase64Url,
  verifyResumeToken,
  type ActivityManifest,
  type ClientConfig,
  type IceServer,
  type JoinResponse,
  type RoomRecord,
  type Tier,
  type VideoTier,
  type VideoTierRule,
} from '@orvo/protocol';
import { LATENCY_BUCKETS, Metrics } from '@orvo/metrics';
import { NoNodesError, placeRoom, type NodeInfo, type PlacementStore } from '@orvo/placement';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AuthOptions, Identity } from './auth';
import type { SigningKey } from './keys';
import { turnCredentials, type TurnPool } from './turn';

/**
 * Decides what an entitlement token grants for a room. It is the seam for a future billing service:
 * return `relay-lite` or `full` for a valid token, `undefined` otherwise. Without a verifier every room is free.
 */
export type EntitlementVerifier = (token: string, room: string) => Promise<Exclude<Tier, 'free'> | undefined>;

/** What a signed-in person's plan grants a room they join, for when entitlements come from accounts rather than tokens. */
export type PlanLookup = (identity: Identity, room: string) => Promise<Exclude<Tier, 'free'> | undefined>;

/**
 * Settings an operator can change while the server runs. `live()` is read on every request and its fields replace the
 * same fields of the options, so a missing field here means "none", not "keep the option's value".
 */
export interface LiveSettings {
  limits?: { maxRoomSize?: number; warnRoomSize?: number; videoTiers?: VideoTierRule[]; relayVideoTier?: VideoTier };
  stunUrls?: string[];
  turn?: { 'relay-lite'?: TurnPool; full?: TurnPool };
  defaultTier?: Exclude<Tier, 'free'>;
  minClientVersion?: string;
  announcement?: { id: string; text: string };
  integrations?: { giphyApiKey?: string };
  roomCreation?: 'anyone' | 'signed-in';
  defaultRoomAccess?: 'anyone' | 'signed-in';
}

export interface BeaconOptions {
  /** When set, the fields it returns replace the matching options on every request. See `LiveSettings`. */
  live?: () => LiveSettings;
  signingKey: SigningKey;
  /** Public keys (key id to base64url) of earlier signing keys, still published so key rotation needs no downtime. */
  previousPublicKeys?: Record<string, string>;
  store: PlacementStore;
  stunUrls: string[];
  /** TURN pools by tier. Only entitled rooms receive credentials for them; `free` rooms get STUN only. */
  turn?: { 'relay-lite'?: TurnPool; full?: TurnPool };
  entitlements?: EntitlementVerifier;
  /** A tier every room has without an entitlement, for a personal server whose operator pays for the relay themselves. */
  defaultTier?: Exclude<Tier, 'free'>;
  planFor?: PlanLookup;
  /** Lets people sign in with an OpenID Connect provider. Without it everyone is a guest. */
  auth?: AuthOptions;
  /** Who may start a room. `signed-in` needs `auth`. Defaults to `anyone`. */
  roomCreation?: 'anyone' | 'signed-in';
  /** Whether new rooms admit guests unless their creator says otherwise. Needs `auth` to be `signed-in`. */
  defaultRoomAccess?: 'anyone' | 'signed-in';
  /** How long a room's owner and access rules are remembered after the last join. Default one day. */
  roomRecordTtlMs?: number;
  /** Public WebSocket URL for a node. Defaults to the node's own `url`, else the request's host (single container). */
  nodeUrl?: (node: NodeInfo, req: FastifyRequest) => string;
  minClientVersion?: string;
  /** Room limits published in the signed config and enforced by nodes through the join token. */
  limits?: { maxRoomSize?: number; warnRoomSize?: number; videoTiers?: VideoTierRule[]; relayVideoTier?: VideoTier };
  /** A notice shown to every client, for example about maintenance. */
  announcement?: { id: string; text: string };
  /** Published to clients in the signed config. A Giphy Web SDK key is meant to be public, but it is still the operator's quota. */
  integrations?: { giphyApiKey?: string };
  /** Activities clients can start in a call, published in the signed config. */
  activities?: ActivityManifest[];
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
// Also how long someone who has left can come back to a locked room, so long enough to cover a network drop.
const RESUME_TOKEN_TTL_MS = 6 * 3600_000;
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
  // Options, with whatever the operator has changed since the server started laid over them.
  const cur = () => ({ ...opts, ...opts.live?.() });
  const roomRecordTtl = opts.roomRecordTtlMs ?? 24 * 3600_000;
  const initial = cur();
  if ((initial.roomCreation === 'signed-in' || initial.defaultRoomAccess === 'signed-in') && !opts.auth) {
    throw new Error('Requiring sign-in needs an identity provider: configure `auth` (OIDC_ISSUER and OIDC_CLIENT_ID).');
  }

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
    joins: metrics.counter('orvo_beacon_join_requests_total', 'Join requests, by outcome.', ['result'] as const),
    joinSeconds: metrics.histogram('orvo_beacon_join_duration_seconds', 'Time to answer a join request.', LATENCY_BUCKETS),
    authRefusals: metrics.counter('orvo_beacon_auth_refusals_total', 'Requests refused for sign-in reasons, by code.', ['code'] as const),
    tiers: metrics.counter('orvo_beacon_joins_by_tier_total', 'Successful joins, by room tier.', ['tier'] as const),
    rooms: metrics.counter('orvo_beacon_rooms_created_total', 'Rooms created.'),
    versions: metrics.counter('orvo_beacon_joins_by_client_version_total', 'Successful joins, by client version (bounded; extras are "other").', ['version'] as const),
    configs: metrics.counter('orvo_beacon_config_requests_total', 'Config requests served.'),
  };
  // What clients report about their own connections, aggregated here and never stored per user.
  const client = {
    joins: metrics.counter('orvo_client_joins_total', 'Client-reported room joins, by result.', ['result'] as const),
    joinSeconds: metrics.histogram('orvo_client_join_seconds', 'Client-measured time to join a room.', LATENCY_BUCKETS),
    peers: metrics.counter('orvo_client_peer_connections_total', 'Client-reported peer connections, by result and route.', ['result', 'route'] as const),
    peerSeconds: metrics.histogram('orvo_client_peer_connect_seconds', 'Client-measured time to connect to a peer.', LATENCY_BUCKETS, ['route'] as const),
    reconnects: metrics.counter('orvo_client_signaling_reconnects_total', 'Signaling reconnections, by outcome.', ['ok'] as const),
  };
  metrics.gauge('orvo_beacon_nodes', 'Signaling nodes currently registered.', async () => (await opts.store.listNodes()).length);
  metrics.gauge('orvo_beacon_placement_degraded', '1 while the shared placement store is unreachable and answers come from memory.', () =>
    (opts.store as { degraded?: boolean }).degraded ? 1 : 0,
  );
  metrics.gauge('orvo_beacon_nodes_draining', 'Registered signaling nodes that are draining.', async () =>
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

  await app.register(cors, { origin: opts.corsOrigin ?? true, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'] });
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
    const c = cur();
    const config: ClientConfig = {
      version: Math.floor(t / 1000),
      issuedAt: t,
      validUntil: t + CONFIG_TTL_MS,
      minClientVersion: c.minClientVersion ?? '0.0.0',
      minProtocol: 1,
      beaconUrls: [requestOrigin(req)],
      limits: {
        maxRoomSize: c.limits?.maxRoomSize ?? MAX_ROOM_SIZE,
        warnRoomSize: c.limits?.warnRoomSize ?? WARN_ROOM_SIZE,
        videoTiers: c.limits?.videoTiers ?? DEFAULT_VIDEO_TIERS,
        relayVideoTier: c.limits?.relayVideoTier,
      },
      features: {},
      ice: { stunUrls: c.stunUrls },
      regions: [{ id: 'default', name: 'Default' }],
      announcement: c.announcement,
      activities: opts.activities?.length ? opts.activities : undefined,
      integrations: c.integrations?.giphyApiKey ? { giphyApiKey: c.integrations.giphyApiKey } : undefined,
      auth: opts.auth
        ? {
            issuer: opts.auth.issuer,
            clientId: opts.auth.clientId,
            clientSecret: opts.auth.clientSecret,
            desktop: opts.auth.desktop,
            scope: opts.auth.scope ?? 'openid profile email',
            createRequiresLogin: c.roomCreation === 'signed-in',
          }
        : undefined,
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

  /**
   * Who is asking: a guest (no token), a signed-in person, or someone whose token was refused. A token sent to a server
   * with no identity provider is ignored, so a client that is signed in elsewhere still works as a guest here.
   */
  async function whoIs(req: FastifyRequest): Promise<{ ok: true; identity?: Identity } | { ok: false }> {
    const header = req.headers.authorization;
    if (!header || !opts.auth) return { ok: true };
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    const identity = token ? await opts.auth.verify(token) : undefined;
    return identity ? { ok: true, identity } : { ok: false };
  }

  const refused = (reply: FastifyReply, status: number, error: string, code: string) => {
    m.authRefusals.inc({ code });
    return reply.code(status).send({ error, code });
  };

  const newRecord = (identity: Identity | undefined, signedInOnly: boolean | undefined): RoomRecord => ({
    owner: identity?.id,
    // A room nobody can sign in to would lock everyone out, so the flag only counts when sign-in exists.
    signedInOnly: Boolean(opts.auth) && (signedInOnly ?? cur().defaultRoomAccess === 'signed-in'),
    locked: false,
    createdAt: now(),
  });

  app.post('/v1/rooms', limited, async (req, reply) => {
    const who = await whoIs(req);
    if (!who.ok) return refused(reply, 401, 'Your sign-in was not accepted. Sign in again.', INVALID_TOKEN);
    if (cur().roomCreation === 'signed-in' && !who.identity) {
      return refused(reply, 401, 'Sign in to start a room.', LOGIN_REQUIRED_TO_CREATE);
    }
    const body = CreateRoomRequest.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Invalid request.', code: 'bad-request' });
    m.rooms.inc();
    const room = generateRoomId();
    const record = await opts.store.createRoom(room, newRecord(who.identity, body.data.signedInOnly), roomRecordTtl);
    return { room, signedInOnly: record.signedInOnly };
  });

  /** Only the signed-in owner of a room can change who may join it. */
  app.patch<{ Params: { room: string } }>('/v1/rooms/:room', limited, async (req, reply) => {
    const who = await whoIs(req);
    if (!who.ok) return refused(reply, 401, 'Your sign-in was not accepted. Sign in again.', INVALID_TOKEN);
    if (!who.identity) return refused(reply, 401, 'Sign in to change a room.', 'login-required');
    const body = UpdateRoomRequest.safeParse(req.body);
    if (!body.success || !isValidRoomSlug(req.params.room)) return reply.code(400).send({ error: 'Invalid request.', code: 'bad-request' });
    const record = await opts.store.getRoom(req.params.room);
    if (!record) return reply.code(404).send({ error: 'That room is not in use.', code: 'room-not-found' });
    if (!record.owner || record.owner !== who.identity.id) return refused(reply, 403, 'Only the person who made this room can change it.', 'not-owner');
    const { signedInOnly, locked } = body.data;
    // Requiring sign-in where nobody can sign in would lock everyone out, so it is ignored there.
    const updated = {
      ...record,
      signedInOnly: signedInOnly === undefined ? record.signedInOnly : Boolean(opts.auth) && signedInOnly,
      locked: locked ?? record.locked,
    };
    await opts.store.updateRoom(req.params.room, updated, roomRecordTtl);
    return { room: req.params.room, signedInOnly: updated.signedInOnly, locked: updated.locked };
  });

  /** The room's tier: the best of what it already has and what this joiner's entitlement grants. */
  async function tierFor(room: string, entitlement: string | undefined, identity: Identity | undefined): Promise<Tier> {
    let tier: Tier = (await opts.store.getRoomTier(room)) ?? cur().defaultTier ?? 'free';
    const grants = [
      entitlement && opts.entitlements ? await opts.entitlements(entitlement, room) : undefined,
      identity && opts.planFor ? await opts.planFor(identity, room) : undefined,
    ];
    for (const granted of grants) if (granted && TIER_RANK[granted] > TIER_RANK[tier]) tier = granted;
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
      { minClientVersion: cur().minClientVersion ?? '0.0.0', minProtocol: 1 },
    );
    if (!supported) {
      done('upgrade-required');
      return reply.code(426).send({ error: 'Please update Orvo.', code: 'upgrade-required' });
    }

    const who = await whoIs(req);
    if (!who.ok) {
      done('invalid-token');
      return refused(reply, 401, 'Your sign-in was not accepted. Sign in again.', INVALID_TOKEN);
    }

    // A room nobody has used lately does not exist, so joining it starts it, under the server's rules for starting rooms.
    let record = await opts.store.getRoom(body.room);
    if (!record) {
      if (cur().roomCreation === 'signed-in' && !who.identity) {
        done('login-required');
        return refused(reply, 401, 'Sign in to start a room.', LOGIN_REQUIRED_TO_CREATE);
      }
      record = await opts.store.createRoom(body.room, newRecord(who.identity, undefined), roomRecordTtl);
    } else {
      await opts.store.touchRoom(body.room, roomRecordTtl);
    }
    if (record.signedInOnly && !who.identity) {
      done('login-required');
      return refused(reply, 401, 'This room is for signed-in people. Sign in to join.', LOGIN_REQUIRED_TO_JOIN);
    }

    // A locked room admits only people who were already in it (they hold a resume token for it) and its owner.
    const t = now();
    const resumed = body.resume ? verifyResumeToken(body.resume, { keys: { [kid]: publicKey }, now: t, room: body.room }) : null;
    const isOwner = Boolean(who.identity && record.owner && record.owner === who.identity.id);
    if (record.locked && !resumed && !isOwner) {
      done('locked');
      return refused(reply, 403, 'This room is locked. Only people who were already in it can join.', ROOM_LOCKED);
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

    const peerId = resumed?.peerId ?? `p${randomId(6)}`;
    const url = opts.nodeUrl?.(node, req) ?? node.url ?? requestOrigin(req).replace(/^http/, 'ws') + '/ws';

    const tier = await tierFor(body.room, body.entitlement, who.identity);
    const c = cur();
    const maxRoomSize = c.limits?.maxRoomSize ?? MAX_ROOM_SIZE;
    const iceServers: IceServer[] = c.stunUrls.length ? [{ urls: c.stunUrls }] : [];
    const pool = tier === 'free' ? undefined : c.turn?.[tier];
    if (pool) iceServers.push(turnCredentials(pool, peerId, t));

    const response: JoinResponse = {
      signalingUrl: url,
      joinToken: signJoinToken(
        { room: body.room, nodeId: node.id, peerId, exp: t + JOIN_TOKEN_TTL_MS, nonce: randomId(12), maxRoomSize, owner: isOwner || undefined, acct: who.identity?.id },
        kid,
        secretKey,
      ),
      resumeToken: signResumeToken({ room: body.room, peerId, exp: t + RESUME_TOKEN_TTL_MS }, kid, secretKey),
      peerId,
      iceServers,
      transport: 'mesh',
      tier,
      room: { signedInOnly: record.signedInOnly, owner: isOwner, locked: record.locked },
    };
    done('ok');
    m.tiers.inc({ tier });
    m.versions.inc({ version: versionLabel(body.clientVersion) });
    return response;
  });

  return app;
}
