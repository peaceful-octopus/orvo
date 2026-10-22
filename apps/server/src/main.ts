import { createBeaconApp, loadOrCreateSigningKey, serveWebApp } from '@chillcall/beacon';
import { MemoryPlacementStore } from '@chillcall/placement';
import { SignalingServer } from '@chillcall/signaling';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All-in-one server for personal use: web app, beacon API and signaling node in one process.
const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DATA_DIR ?? './data';
const webDir = process.env.WEB_DIR ?? path.resolve(here, '../../app/dist');
const nodeId = 'local';

const signingKey = loadOrCreateSigningKey(dataDir);
const app = await createBeaconApp({
  signingKey,
  store: new MemoryPlacementStore([{ id: nodeId, region: 'default', weight: 1, draining: false }]),
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean),
  minClientVersion: process.env.MIN_CLIENT_VERSION,
  limits: process.env.MAX_ROOM_SIZE
    ? { maxRoomSize: Number(process.env.MAX_ROOM_SIZE), warnRoomSize: Number(process.env.WARN_ROOM_SIZE ?? 6) }
    : undefined,
  announcement: process.env.ANNOUNCEMENT ? { id: process.env.ANNOUNCEMENT_ID ?? 'notice', text: process.env.ANNOUNCEMENT } : undefined,
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  trustProxy: Boolean(process.env.BEHIND_PROXY),
});

const signaling = new SignalingServer({ nodeId, keys: { [signingKey.kid]: signingKey.publicKey } });
signaling.attach(app.server);

app.get('/readyz', async (_req, reply) =>
  reply.code(signaling.draining ? 503 : 200).send(signaling.draining ? 'draining' : 'ready'),
);
app.get('/metrics', async (_req, reply) => reply.type('text/plain').send(signaling.renderMetrics()));

if (!(await serveWebApp(app, webDir))) console.warn(`No web app found at ${webDir}; serving the API and signaling only.`);

await app.listen({ port, host: '0.0.0.0' });
console.log(`ChillCall listening on :${port}`);

process.on('SIGTERM', () => {
  signaling.drain();
  setTimeout(async () => {
    signaling.close();
    await app.close();
    process.exit(0);
  }, Number(process.env.DRAIN_MS ?? 5_000));
});
