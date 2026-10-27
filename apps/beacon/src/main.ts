import {
  MemoryPlacementStore,
  RedisPlacementStore,
  ResilientPlacementStore,
  type NodeInfo,
  type PlacementStore,
} from '@orvo/placement';
import { Redis } from 'ioredis';
import fs from 'node:fs';
import { createBeaconApp } from './app';
import { authSettingsFromEnv } from './auth-env';
import { relayVideoTierFromEnv } from './limits-env';
import { loadOrCreateSigningKey } from './keys';
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
function pool(urls: string | undefined, secret: string | undefined): TurnPool | undefined {
  return urls && secret ? { urls: urls.split(',').filter(Boolean), secret } : undefined;
}

let store: PlacementStore;
if (process.env.REDIS_URL) {
  // Keep placing rooms from memory if Redis becomes unreachable, instead of failing every join.
  store = new ResilientPlacementStore(new RedisPlacementStore(new Redis(process.env.REDIS_URL)), {
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

const app = await createBeaconApp({
  ...authSettingsFromEnv(process.env),
  signingKey: loadOrCreateSigningKey(process.env.DATA_DIR ?? './data'),
  previousPublicKeys: process.env.PREVIOUS_PUBLIC_KEYS ? JSON.parse(process.env.PREVIOUS_PUBLIC_KEYS) : undefined,
  store,
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean),
  turn: {
    full: pool(process.env.TURN_URLS, process.env.TURN_SECRET),
    'relay-lite': pool(process.env.TURN_LITE_URLS, process.env.TURN_LITE_SECRET),
  },
  minClientVersion: process.env.MIN_CLIENT_VERSION,
  limits: {
    ...(process.env.MAX_ROOM_SIZE ? { maxRoomSize: Number(process.env.MAX_ROOM_SIZE), warnRoomSize: Number(process.env.WARN_ROOM_SIZE ?? 6) } : {}),
    relayVideoTier: relayVideoTierFromEnv(process.env),
  },
  announcement: process.env.ANNOUNCEMENT ? { id: process.env.ANNOUNCEMENT_ID ?? 'notice', text: process.env.ANNOUNCEMENT } : undefined,
  staticConfig: process.env.CONFIG_FILE ? JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8')) : undefined,
  // 0 turns limiting off, which load tests need because every simulated user shares one address.
  rateLimitPerMinute: process.env.RATE_LIMIT_PER_MINUTE ? Number(process.env.RATE_LIMIT_PER_MINUTE) || false : undefined,
  integrations: { giphyApiKey: process.env.GIPHY_API_KEY || undefined },
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  trustProxy: Boolean(process.env.BEHIND_PROXY),
});
if (process.env.WEB_DIR && !(await serveWebApp(app, process.env.WEB_DIR))) {
  console.warn(`WEB_DIR ${process.env.WEB_DIR} has no index.html; serving the API only.`);
}
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
