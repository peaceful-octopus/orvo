import { createBeaconServer } from '@orvo/beacon';
import { Metrics } from '@orvo/metrics';
import { MemoryPlacementStore } from '@orvo/placement';
import { SignalingServer } from '@orvo/signaling';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All-in-one server for personal use: web app, beacon API and signaling node in one process. The beacon is set up as
// in every other deployment (`createBeaconServer`); this file adds the signaling node and its drain on shutdown.
const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const nodeId = 'local';
// One registry for the whole process, so /metrics shows the beacon and the signaling node together.
const metrics = new Metrics({ defaultMetrics: true });

const server = await createBeaconServer({
  env: process.env,
  store: new MemoryPlacementStore([{ id: nodeId, region: 'default', weight: 1, draining: false }]),
  metrics,
  webDir: process.env.WEB_DIR ?? path.resolve(here, '../../app/dist'),
  // Activities that ship with the server; an operator's own come from ACTIVITIES_DIR.
  bundledActivities: path.resolve(here, '../activities'),
  // There is no entitlement service on a personal server to grant a relay, so one that is configured serves every room.
  relayForEveryRoom: true,
});
const { app } = server;

const signaling = new SignalingServer({
  nodeId,
  keys: { [server.signingKey.kid]: server.signingKey.publicKey },
  metrics: { registry: metrics.registry },
});
signaling.attach(app.server);

app.get('/readyz', async (_req, reply) =>
  reply.code(signaling.draining ? 503 : 200).send(signaling.draining ? 'draining' : 'ready'),
);

await server.listen(port);
console.log(`Orvo listening on :${port}`);

process.on('SIGTERM', () => {
  signaling.drain();
  setTimeout(async () => {
    signaling.close();
    await server.close();
    process.exit(0);
  }, Number(process.env.DRAIN_MS ?? 5_000));
});
