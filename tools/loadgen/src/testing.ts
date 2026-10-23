import { createBeaconApp } from '@orvo/beacon';
import { NodeAgent, RedisPlacementStore, ResilientPlacementStore, type PlacementStore } from '@orvo/placement';
import { SignalingServer } from '@orvo/signaling';
import { testKeys } from '@orvo/testkit';
import { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Beacon = Awaited<ReturnType<typeof createBeaconApp>>;

export interface HarnessNode {
  id: string;
  signaling: SignalingServer;
  server: http.Server;
  agent: NodeAgent;
  url: string;
  alive: boolean;
}

export interface Harness {
  beaconUrl: string;
  nodes: HarnessNode[];
  /** Makes every placement-store call fail, as if Redis were unreachable. */
  redis: { down: boolean };
  /** Stops a node. `clean` deregisters it and closes connections politely; otherwise it just vanishes. */
  killNode(id: string, mode: 'clean' | 'crash'): Promise<void>;
  /** Drains a node (no new rooms), as a rolling restart does before stopping it. */
  drainNode(id: string): Promise<void>;
  stopBeacon(): Promise<void>;
  startBeacon(): Promise<void>;
  close(): Promise<void>;
}

/** Wraps a store so every method fails on demand. */
function failable(inner: PlacementStore, state: { down: boolean }): PlacementStore {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        if (state.down) throw new Error('connection refused');
        return value.apply(target, args);
      };
    },
  });
}

/**
 * A beacon and several signaling nodes in this process, sharing a Redis (an in-memory stand-in unless REDIS_URL
 * is set), reachable over real HTTP and WebSockets so simulated clients behave as they would against a deployment.
 */
export async function startHarness(opts: { nodes: number; nodeTtlMs?: number; heartbeatMs?: number }): Promise<Harness> {
  const key = testKeys('harness-1');
  const redis = { down: false };
  const raw = new RedisPlacementStore(process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : (new RedisMock() as never), `h-${Date.now()}-${Math.random()}:`);
  const shared = failable(raw, redis);

  const nodes: HarnessNode[] = [];
  for (let i = 0; i < opts.nodes; i++) {
    const id = `node-${i}`;
    const signaling = new SignalingServer({ nodeId: id, keys: key.keys, resumeGraceMs: 2000 });
    const server = http.createServer();
    signaling.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const url = `ws://localhost:${(server.address() as AddressInfo).port}/ws`;
    const agent = new NodeAgent(
      shared,
      { id, url, region: 'r', weight: 1 },
      () => ({ rooms: signaling.roomIds(), connections: signaling.stats().connections }),
      { nodeTtlMs: opts.nodeTtlMs, heartbeatMs: opts.heartbeatMs, leaseRenewMs: 1000, onError: () => {} },
    );
    await agent.start();
    nodes.push({ id, signaling, server, agent, url, alive: true });
  }

  // The beacon sees the same store through the resilient wrapper, as in a real deployment.
  const beaconStore = new ResilientPlacementStore(shared);
  let beacon: Beacon | undefined;
  let port = 0;
  const startBeacon = async () => {
    beacon = await createBeaconApp({
      signingKey: { kid: key.kid, publicKey: key.publicKey, secretKey: key.secretKey },
      store: beaconStore,
      stunUrls: [],
      rateLimitPerMinute: false,
    });
    await beacon.listen({ port, host: '127.0.0.1' });
    port = (beacon.server.address() as AddressInfo).port;
  };
  await startBeacon();

  const find = (id: string) => nodes.find((n) => n.id === id)!;
  return {
    get beaconUrl() {
      return `http://127.0.0.1:${port}`;
    },
    nodes,
    redis,
    async killNode(id, mode) {
      const node = find(id);
      node.alive = false;
      if (mode === 'clean') await node.agent.stop();
      else node.agent.halt();
      node.signaling.close();
      node.server.closeAllConnections();
      await new Promise((resolve) => node.server.close(resolve));
    },
    async drainNode(id) {
      const node = find(id);
      node.signaling.drain();
      await node.agent.drain();
    },
    async stopBeacon() {
      await beacon?.close();
    },
    startBeacon,
    async close() {
      await beacon?.close();
      for (const node of nodes) {
        if (!node.alive) continue;
        await node.agent.stop();
        node.signaling.close();
        node.server.closeAllConnections();
        await new Promise((resolve) => node.server.close(resolve));
      }
    },
  };
}
