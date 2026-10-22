import { NodeAgent, RedisPlacementStore } from '@chillcall/placement';
import { keyRingFromJson, fromBase64Url, type KeyRing } from '@chillcall/protocol';
import { Redis } from 'ioredis';
import http from 'node:http';
import os from 'node:os';
import { SignalingServer } from './server';

// Standalone signaling node.
//   TRUSTED_KEYS   JSON { "<kid>": "<base64url public key>" }, or
//   BEACON_URL     fetch the beacon's public keys from <BEACON_URL>/v1/keys at start
//   REDIS_URL + PUBLIC_WS_URL   register in Redis so the beacon can place rooms here
//   NODE_ID, REGION, WEIGHT, PORT, DRAIN_MS
async function fetchBeaconKeys(beacon: string): Promise<KeyRing> {
  const res = await fetch(new URL('/v1/keys', beacon), { signal: AbortSignal.timeout(5000) });
  const keys = (await res.json()) as Record<string, string>;
  return Object.fromEntries(Object.entries(keys).map(([kid, key]) => [kid, fromBase64Url(key)]));
}

async function loadKeys(): Promise<KeyRing> {
  if (process.env.TRUSTED_KEYS) return keyRingFromJson(process.env.TRUSTED_KEYS);
  const beacon = process.env.BEACON_URL;
  if (!beacon) throw new Error('Set TRUSTED_KEYS or BEACON_URL so the node can verify join tokens');
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchBeaconKeys(beacon);
    } catch (err) {
      if (attempt >= 30) throw err;
      console.warn(`waiting for the beacon at ${beacon}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const port = Number(process.env.PORT ?? 9000);
const nodeId = process.env.NODE_ID ?? os.hostname();
const keys = await loadKeys();
const signaling = new SignalingServer({ nodeId, keys, metrics: { defaultMetrics: true } });

// Learn new beacon keys without a restart, so a key rotation does not interrupt anyone. Keys are only ever added
// to the ring: removing an old key is done by restarting the node once the old tokens have expired.
if (!process.env.TRUSTED_KEYS && process.env.BEACON_URL) {
  const beacon = process.env.BEACON_URL;
  setInterval(() => {
    fetchBeaconKeys(beacon).then(
      (fresh) => Object.assign(keys, fresh),
      () => {}, // keep the keys we have; the beacon may be briefly unreachable
    );
  }, 5 * 60_000).unref();
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/healthz') return void res.end('ok');
  if (path === '/readyz') {
    res.statusCode = signaling.draining ? 503 : 200;
    return void res.end(signaling.draining ? 'draining' : 'ready');
  }
  if (path === '/metrics') return void res.setHeader('content-type', signaling.metrics.contentType).end(await signaling.renderMetrics());
  res.statusCode = 404;
  res.end();
});
signaling.attach(server);
server.listen(port, () => console.log(`signaling node ${nodeId} listening on :${port}`));

let agent: NodeAgent | undefined;
if (process.env.REDIS_URL) {
  const publicUrl = process.env.PUBLIC_WS_URL;
  if (!publicUrl) throw new Error('PUBLIC_WS_URL is required with REDIS_URL, for example wss://n1.example.com/ws');
  agent = new NodeAgent(
    new RedisPlacementStore(new Redis(process.env.REDIS_URL)),
    { id: nodeId, url: publicUrl, region: process.env.REGION ?? 'default', weight: Number(process.env.WEIGHT ?? 1) },
    () => ({ rooms: signaling.roomIds(), connections: signaling.stats().connections }),
    { onError: (err) => console.warn('placement store error', err) },
  );
  await agent.start();
}

// Stop receiving new rooms, give clients time to finish, then disconnect them so they reconnect elsewhere.
process.on('SIGTERM', () => {
  signaling.drain();
  void agent?.drain();
  setTimeout(async () => {
    await agent?.stop();
    signaling.close();
    server.close(() => process.exit(0));
  }, Number(process.env.DRAIN_MS ?? 30_000));
});
