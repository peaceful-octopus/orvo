import {
  MemoryPlacementStore,
  RedisPlacementStore,
  ResilientPlacementStore,
  type NodeInfo,
  type PlacementStore,
} from '@orvo/placement';
import { Redis } from 'ioredis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminReachable, registerAdminRoutes } from './admin';
import { loadActivities, serveActivities } from './activities';
import { createBeaconApp } from './app';
import { authSettingsFromEnv } from './auth-env';
import { loadOrCreateSigningKey } from './keys';
import { SettingsStore, settingsFromEnv } from './settings';
import { fileSettings, redisSettings } from './settings-backend';
import type { TurnPool } from './turn';
import { serveWebApp } from './web';

// Standalone beacon for deployments that run signaling nodes as separate services.
//   REDIS_URL        nodes register themselves in Redis (several beacons can share it)
//   NODES            without Redis, a static JSON list such as [{"id":"n1","url":"wss://n1.example.com/ws"}]
//   SIGNING_KEY      <kid>:<base64url secret>, shared by every beacon in a fleet
//   PREVIOUS_PUBLIC_KEYS   JSON { "<old kid>": "<base64url public key>" } kept published while rotating keys
//   TURN_URLS / TURN_SECRET            credentialed relay pool for entitled rooms
//   TURN_LITE_URLS / TURN_LITE_SECRET  capped relay pool for the relay-lite tier
//   CONFIG_FILE      a pre-signed config served as is (see tools/sign-config)
//   MIN_CLIENT_VERSION, MAX_ROOM_SIZE, WARN_ROOM_SIZE, ANNOUNCEMENT(_ID)   published in the signed config
//   RATE_LIMIT_PER_MINUTE   per client address (default 120; 0 disables)
//   GIPHY_API_KEY    a Giphy Web SDK key, published to clients so they can offer a GIF picker
//   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_AUDIENCE, OIDC_SCOPE   let people sign in with an OpenID Connect provider
//   ROOM_CREATION    `anyone` (default) or `signed-in`: who may start a room
//   DEFAULT_ROOM_ACCESS   `anyone` (default) or `signed-in`: who may join a new room unless its creator chose otherwise
//   WEB_DIR          also serve the built web app from this directory
//   ADMIN_PASSWORD   turns on the admin page. Its changes to the settings below are kept in Redis (or, without Redis, in
//                    DATA_DIR/settings.json), so every beacon uses them, and a beacon that starts later reads the current ones.
//   ACTIVITIES_DIR   activities to offer in calls besides the bundled ones (default DATA_DIR/activities)
// The settings the admin page can change (room size, announcement, STUN and TURN, relay video, Giphy key, sign-in
// rules, minimum client version) are read from the environment only as the starting values.
function pool(urls: string | undefined, secret: string | undefined): TurnPool | undefined {
  return urls && secret ? { urls: urls.split(',').filter(Boolean), secret } : undefined;
}

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : undefined;
let store: PlacementStore;
if (redis) {
  // Keep placing rooms from memory if Redis becomes unreachable, instead of failing every join.
  store = new ResilientPlacementStore(new RedisPlacementStore(redis), {
    onDegraded: (degraded, err) => console.warn(degraded ? 'placement store unreachable, using last known nodes' : 'placement store recovered', err ?? ''),
  });
} else {
  const nodes = (JSON.parse(process.env.NODES ?? '[]') as Partial<NodeInfo>[]).map((n) => ({
    id: n.id!,
    url: n.url,
    region: n.region ?? 'default',
    weight: n.weight ?? 1,
    draining: n.draining ?? false,
  }));
  if (nodes.length === 0) throw new Error('Set REDIS_URL, or NODES to list at least one signaling node');
  store = new MemoryPlacementStore(nodes);
}

const dataDir = process.env.DATA_DIR ?? './data';
const here = path.dirname(fileURLToPath(import.meta.url));
const signingKey = loadOrCreateSigningKey(dataDir);
const signIn = authSettingsFromEnv(process.env);
const settings = await SettingsStore.open({
  defaults: settingsFromEnv(process.env, signIn),
  backend: redis ? redisSettings(redis) : fileSettings(path.join(dataDir, 'settings.json')),
  authConfigured: Boolean(signIn.auth),
  defaultAnnouncementId: process.env.ANNOUNCEMENT_ID || 'notice',
});
const liteTurn = pool(process.env.TURN_LITE_URLS, process.env.TURN_LITE_SECRET);
const activities = loadActivities([path.resolve(here, '../activities'), process.env.ACTIVITIES_DIR ?? path.join(dataDir, 'activities')]);

const app = await createBeaconApp({
  ...signIn,
  signingKey,
  previousPublicKeys: process.env.PREVIOUS_PUBLIC_KEYS ? JSON.parse(process.env.PREVIOUS_PUBLIC_KEYS) : undefined,
  store,
  activities: activities.manifests,
  stunUrls: settings.effective().stunUrls,
  live: () => {
    const live = settings.live();
    // Only entitled rooms get a relay here, so the settings' relay is the paid pool and there is no default tier.
    return { ...live, turn: { ...live.turn, 'relay-lite': liteTurn }, defaultTier: undefined };
  },
  staticConfig: process.env.CONFIG_FILE ? JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8')) : undefined,
  // 0 turns limiting off, which load tests need because every simulated user shares one address.
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE ? Number(process.env.RATE_LIMIT_PER_MINUTE) || false : undefined,
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  trustProxy: Boolean(process.env.BEHIND_PROXY),
});
if (process.env.ADMIN_PASSWORD) {
  await registerAdminRoutes(app, { store: settings, password: process.env.ADMIN_PASSWORD, signingKey, allowRemote: process.env.ADMIN_ALLOW_REMOTE === '1' });
}
await serveActivities(app, activities);
if (process.env.WEB_DIR && !(await serveWebApp(app, process.env.WEB_DIR, { adminVisible: (req) => adminReachable(req, process.env.ADMIN_ALLOW_REMOTE === '1') }))) {
  console.warn(`WEB_DIR ${process.env.WEB_DIR} has no index.html; serving the API only.`);
}
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
