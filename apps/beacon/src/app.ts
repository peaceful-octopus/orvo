import {
  ClientConfig,
  JoinRequest,
  PROTOCOL_VERSION,
  generateRoomId,
  isClientSupported,
  isValidRoomSlug,
  randomId,
  signConfig,
  signJoinToken,
  signResumeToken,
  toBase64Url,
  verifyResumeToken,
  type JoinResponse,
} from '@chillcall/protocol';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { SigningKey } from './keys';
import { NoNodesError, placeRoom, type NodeInfo, type PlacementStore } from './placement';

export interface BeaconOptions {
  signingKey: SigningKey;
  store: PlacementStore;
  stunUrls: string[];
  /** Public WebSocket URL for a node. Defaults to the node's own `url`, else the request's host (single container). */
  nodeUrl?: (node: NodeInfo, req: FastifyRequest) => string;
  minClientVersion?: string;
  now?: () => number;
  corsOrigin?: string | boolean;
  /** Requests per minute per client IP; `false` disables limiting. */
  rateLimitPerMinute?: number | false;
  trustProxy?: boolean;
}

const JOIN_TOKEN_TTL_MS = 60_000;
const RESUME_TOKEN_TTL_MS = 15 * 60_000;
const CONFIG_TTL_MS = 3600_000;

function requestOrigin(req: FastifyRequest): string {
  return `${req.protocol}://${req.headers.host}`;
}

export async function createBeaconApp(opts: BeaconOptions): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const { kid, secretKey, publicKey } = opts.signingKey;
  const app = Fastify({ trustProxy: opts.trustProxy ?? false });

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
    const t = now();
    const config: ClientConfig = {
      version: Math.floor(t / 1000),
      issuedAt: t,
      validUntil: t + CONFIG_TTL_MS,
      minClientVersion: opts.minClientVersion ?? '0.0.0',
      minProtocol: 1,
      beaconUrls: [requestOrigin(req)],
      limits: {
        maxRoomSize: 10,
        warnRoomSize: 6,
        videoTiers: [
          { maxPeers: 4, maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
          { maxPeers: 6, maxBitrate: 500_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
          { maxPeers: 10, maxBitrate: 250_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
        ],
      },
      features: {},
      ice: { stunUrls: opts.stunUrls },
      regions: [{ id: 'default', name: 'Default' }],
    };
    return reply.header('cache-control', 'max-age=60').send(signConfig(config, kid, secretKey));
  });

  app.post('/v1/rooms', limited, async () => ({ room: generateRoomId() }));

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

    const response: JoinResponse = {
      signalingUrl: url,
      joinToken: signJoinToken(
        { room: body.room, nodeId: node.id, peerId, exp: t + JOIN_TOKEN_TTL_MS, nonce: randomId(12) },
        kid,
        secretKey,
      ),
      resumeToken: signResumeToken({ room: body.room, peerId, exp: t + RESUME_TOKEN_TTL_MS }, kid, secretKey),
      peerId,
      iceServers: opts.stunUrls.length ? [{ urls: opts.stunUrls }] : [],
      transport: 'mesh',
      tier: 'free',
    };
    return response;
  });

  void PROTOCOL_VERSION;
  return app;
}
