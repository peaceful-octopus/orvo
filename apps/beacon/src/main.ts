import { MemoryPlacementStore, RedisPlacementStore, type NodeInfo, type PlacementStore } from '@chillcall/placement';
import { Redis } from 'ioredis';
import fs from 'node:fs';
import { createBeaconApp } from './app';
import { loadOrCreateSigningKey } from './keys';
import type { TurnPool } from './turn';
import { serveWebApp } from './web';

// Standalone beacon for deployments that run signaling nodes as separate services.
//   REDIS_URL        nodes register themselves in Redis (several beacons can share it)
//   NODES            without Redis, a static JSON list such as [{"id":"n1","url":"wss://n1.example.com/ws"}]
//   SIGNING_KEY      <kid>:<base64url secret>, shared by every beacon in a fleet
//   TURN_URLS / TURN_SECRET            credentialed relay pool for entitled rooms
//   TURN_LITE_URLS / TURN_LITE_SECRET  capped relay pool for the relay-lite tier
//   CONFIG_FILE      a pre-signed config served as is (see tools/sign-config)
//   WEB_DIR          also serve the built web app from this directory
function pool(urls: string | undefined, secret: string | undefined): TurnPool | undefined {
  return urls && secret ? { urls: urls.split(',').filter(Boolean), secret } : undefined;
}

let store: PlacementStore;
if (process.env.REDIS_URL) {
  store = new RedisPlacementStore(new Redis(process.env.REDIS_URL));
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
  signingKey: loadOrCreateSigningKey(process.env.DATA_DIR ?? './data'),
  store,
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean),
  turn: {
    full: pool(process.env.TURN_URLS, process.env.TURN_SECRET),
    'relay-lite': pool(process.env.TURN_LITE_URLS, process.env.TURN_LITE_SECRET),
  },
  staticConfig: process.env.CONFIG_FILE ? JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf8')) : undefined,
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  trustProxy: Boolean(process.env.BEHIND_PROXY),
});
if (process.env.WEB_DIR && !(await serveWebApp(app, process.env.WEB_DIR))) {
  console.warn(`WEB_DIR ${process.env.WEB_DIR} has no index.html; serving the API only.`);
}
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
