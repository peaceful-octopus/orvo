import {
  MemoryPlacementStore,
  RedisPlacementStore,
  ResilientPlacementStore,
  type NodeInfo,
  type PlacementStore,
} from '@orvo/placement';
import { Redis } from 'ioredis';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBeaconServer } from './serve';

// Standalone beacon for deployments that run signaling nodes as separate services. Everything about the beacon itself
// is configured as in `createBeaconServer` (serve.ts); what is specific to this entry point:
//   REDIS_URL        nodes register themselves in Redis (several beacons can share it), and the admin page's saved
//                    settings are kept in it, so every beacon uses them and a beacon that starts later reads the current ones
//   NODES            without Redis, a static JSON list such as [{"id":"n1","url":"wss://n1.example.com/ws"}]
//   WEB_DIR          also serve the built web app from this directory
//   PORT             default 8080
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

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await createBeaconServer({
  env: process.env,
  store,
  redis,
  webDir: process.env.WEB_DIR,
  bundledActivities: path.resolve(here, '../activities'),
  // Only rooms an entitlement names get a relay; the relay in the settings is that paid pool.
  relayForEveryRoom: false,
});
const port = Number(process.env.PORT ?? 8080);
await server.listen(port);
console.log(`Orvo beacon listening on :${port}`);

process.on('SIGTERM', () => {
  void server.close().then(() => process.exit(0));
});
