import { authSettingsFromEnv, createBeaconApp, loadOrCreateSigningKey, serveWebApp } from '@orvo/beacon';
import { Metrics } from '@orvo/metrics';
import { MemoryPlacementStore } from '@orvo/placement';
import { SignalingServer } from '@orvo/signaling';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All-in-one server for personal use: web app, beacon API and signaling node in one process.
const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DATA_DIR ?? './data';
const webDir = process.env.WEB_DIR ?? path.resolve(here, '../../app/dist');
const nodeId = 'local';

const signingKey = loadOrCreateSigningKey(dataDir);
// One registry for the whole process, so /metrics shows the beacon and the signaling node together.
const metrics = new Metrics({ defaultMetrics: true });
const signIn = authSettingsFromEnv(process.env);
// A relay for people whose networks block direct connections. On a personal server the operator runs it for their own
// friends, so with a relay configured every room gets credentials; there is no entitlement service to grant them.
const turnPool = process.env.TURN_URLS && process.env.TURN_SECRET ? { urls: process.env.TURN_URLS.split(',').filter(Boolean), secret: process.env.TURN_SECRET } : undefined;
const app = await createBeaconApp({
  signingKey,
  ...signIn,
  metrics,
  store: new MemoryPlacementStore([{ id: nodeId, region: 'default', weight: 1, draining: false }]),
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean),
  turn: { full: turnPool },
  defaultTier: turnPool ? 'full' : undefined,
  minClientVersion: process.env.MIN_CLIENT_VERSION,
  limits: process.env.MAX_ROOM_SIZE
    ? { maxRoomSize: Number(process.env.MAX_ROOM_SIZE), warnRoomSize: Number(process.env.WARN_ROOM_SIZE ?? 6) }
    : undefined,
  announcement: process.env.ANNOUNCEMENT ? { id: process.env.ANNOUNCEMENT_ID ?? 'notice', text: process.env.ANNOUNCEMENT } : undefined,
  // 0 turns limiting off, which load tests need because every simulated user shares one address.
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE ? Number(process.env.RATE_LIMIT_PER_MINUTE) || false : undefined,
  integrations: { giphyApiKey: process.env.GIPHY_API_KEY || undefined },
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  trustProxy: Boolean(process.env.BEHIND_PROXY),
});

const signaling = new SignalingServer({
  nodeId,
  keys: { [signingKey.kid]: signingKey.publicKey },
  metrics: { registry: metrics.registry },
});
signaling.attach(app.server);

app.get('/readyz', async (_req, reply) =>
  reply.code(signaling.draining ? 503 : 200).send(signaling.draining ? 'draining' : 'ready'),
);

if (!(await serveWebApp(app, webDir))) console.warn(`No web app found at ${webDir}; serving the API and signaling only.`);

await app.listen({ port, host: '0.0.0.0' });
console.log(`Orvo listening on :${port}`);

process.on('SIGTERM', () => {
  signaling.drain();
  setTimeout(async () => {
    signaling.close();
    await app.close();
    process.exit(0);
  }, Number(process.env.DRAIN_MS ?? 5_000));
});
