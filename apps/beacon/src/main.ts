import { createBeaconApp } from './app';
import { loadOrCreateSigningKey } from './keys';
import { MemoryPlacementStore, type NodeInfo } from './placement';

// Standalone beacon for deployments that run signaling nodes as separate services.
// NODES is a JSON array such as [{"id":"n1","url":"wss://n1.example.com/ws"}].
const nodes = (JSON.parse(process.env.NODES ?? '[]') as Partial<NodeInfo>[]).map((n) => ({
  id: n.id!,
  url: n.url,
  region: n.region ?? 'default',
  weight: n.weight ?? 1,
  draining: n.draining ?? false,
}));
if (nodes.length === 0) throw new Error('NODES must list at least one signaling node');

const app = await createBeaconApp({
  signingKey: loadOrCreateSigningKey(process.env.DATA_DIR ?? './data'),
  store: new MemoryPlacementStore(nodes),
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean),
  corsOrigin: process.env.CORS_ORIGIN ?? true,
  trustProxy: Boolean(process.env.BEHIND_PROXY),
});
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
