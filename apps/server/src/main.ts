import { authSettingsFromEnv, createBeaconApp, loadActivities, loadOrCreateSigningKey, registerAdminRoutes, serveActivities, serveWebApp, SettingsStore, settingsFromEnv } from '@orvo/beacon';
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
// Activities the server offers in calls: the ones that ship with it, then any the operator adds (same id replaces).
const activities = loadActivities([
  path.resolve(here, '../activities'),
  process.env.ACTIVITIES_DIR ?? path.join(dataDir, 'activities'),
]);

const signingKey = loadOrCreateSigningKey(dataDir);
// One registry for the whole process, so /metrics shows the beacon and the signaling node together.
const metrics = new Metrics({ defaultMetrics: true });
const signIn = authSettingsFromEnv(process.env);
// What an operator can change while the server runs: the environment gives the starting values, and changes made in the
// admin page are saved in the data directory and win over them. With a relay configured, every room gets credentials,
// since there is no entitlement service on a personal server to grant them.
const settings = new SettingsStore({
  defaults: settingsFromEnv(process.env, signIn),
  file: path.join(dataDir, 'settings.json'),
  authConfigured: Boolean(signIn.auth),
  defaultAnnouncementId: process.env.ANNOUNCEMENT_ID || 'notice',
});
const app = await createBeaconApp({
  signingKey,
  ...signIn,
  metrics,
  activities: activities.manifests,
  store: new MemoryPlacementStore([{ id: nodeId, region: 'default', weight: 1, draining: false }]),
  stunUrls: settings.effective().stunUrls,
  live: () => settings.live(),
  // 0 turns limiting off, which load tests need because every simulated user shares one address.
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE ? Number(process.env.RATE_LIMIT_PER_MINUTE) || false : undefined,
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  trustProxy: Boolean(process.env.BEHIND_PROXY),
});
// The admin page exists only when the server has a password for it.
if (process.env.ADMIN_PASSWORD) {
  await registerAdminRoutes(app, { store: settings, password: process.env.ADMIN_PASSWORD, signingKey, allowRemote: process.env.ADMIN_ALLOW_REMOTE === '1' });
}

const signaling = new SignalingServer({
  nodeId,
  keys: { [signingKey.kid]: signingKey.publicKey },
  metrics: { registry: metrics.registry },
});
signaling.attach(app.server);

app.get('/readyz', async (_req, reply) =>
  reply.code(signaling.draining ? 503 : 200).send(signaling.draining ? 'draining' : 'ready'),
);

await serveActivities(app, activities);
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
