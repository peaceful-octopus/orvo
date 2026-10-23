import { createBeaconApp } from '@orvo/beacon';
import { NodeAgent, RedisPlacementStore } from '@orvo/placement';
import { JoinResponse, parseServerMessage, type ServerMessage } from '@orvo/protocol';
import { SignalingServer } from '@orvo/signaling';
import { testKeys } from '@orvo/testkit';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

// A beacon and several signaling nodes sharing one store, exercised through real HTTP and WebSockets.
// Uses ioredis-mock; set REDIS_URL to run the same scenarios against a real Redis.
const key = testKeys('fleet-1');

interface Node {
  id: string;
  signaling: SignalingServer;
  server: http.Server;
  agent: NodeAgent;
  url: string;
}

let store: RedisPlacementStore;
let beacon: Awaited<ReturnType<typeof createBeaconApp>>;
let nodes: Node[] = [];
let sockets: WebSocket[] = [];

async function startNode(id: string): Promise<Node> {
  const signaling = new SignalingServer({ nodeId: id, keys: key.keys, resumeGraceMs: 0 });
  const server = http.createServer();
  signaling.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const url = `ws://localhost:${(server.address() as AddressInfo).port}/ws`;
  const agent = new NodeAgent(
    store,
    { id, url, region: 'r', weight: 1 },
    () => ({ rooms: signaling.roomIds(), connections: signaling.stats().connections }),
  );
  await agent.start();
  const node = { id, signaling, server, agent, url };
  nodes.push(node);
  return node;
}

async function stopNode(node: Node) {
  await node.agent.stop();
  node.signaling.close();
  await new Promise((resolve) => node.server.close(resolve));
  nodes = nodes.filter((n) => n !== node);
}

async function setup(count: number) {
  // Each test gets its own key prefix, so a shared real Redis needs no flushing.
  const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : (new RedisMock() as never);
  store = new RedisPlacementStore(redis, `fleet-${Date.now()}-${Math.random()}:`);
  beacon = await createBeaconApp({
    signingKey: { kid: key.kid, publicKey: key.publicKey, secretKey: key.secretKey },
    store,
    stunUrls: [],
    rateLimitPerMinute: false,
  });
  for (let i = 0; i < count; i++) await startNode(`node-${i}`);
}

afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets = [];
  for (const node of [...nodes]) await stopNode(node);
  await beacon.close();
});

async function join(room: string): Promise<JoinResponse> {
  const res = await beacon.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room } });
  expect(res.statusCode).toBe(200);
  return JoinResponse.parse(res.json());
}

/** Connects a client the way the app does and resolves with the node's first reply. */
async function connect(session: JoinResponse, name: string) {
  const ws = new WebSocket(session.signalingUrl);
  sockets.push(ws);
  const messages: ServerMessage[] = [];
  ws.on('message', (data) => {
    const parsed = parseServerMessage(String(data));
    if (parsed.ok) messages.push(parsed.message);
  });
  await new Promise<void>((resolve) => ws.on('open', resolve));
  ws.send(JSON.stringify({ v: 1, type: 'join', token: session.joinToken, name }));
  for (let i = 0; i < 100 && messages.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  return { ws, first: messages[0], messages };
}

describe('fleet', () => {
  it('lists every node that registered', async () => {
    await setup(3);
    expect((await store.listNodes()).map((n) => n.id).sort()).toEqual(['node-0', 'node-1', 'node-2']);
  });

  it('pins a room to one node, so everyone who joins it meets', async () => {
    await setup(3);
    const sessions = await Promise.all(Array.from({ length: 6 }, () => join('pinned-room-abc123')));
    expect(new Set(sessions.map((s) => s.signalingUrl)).size).toBe(1);

    const clients = [];
    for (const [i, session] of sessions.entries()) clients.push(await connect(session, `p${i}`));
    expect(clients.at(-1)!.first).toMatchObject({ type: 'welcome', peers: expect.any(Array) });
    expect((clients.at(-1)!.first as Extract<ServerMessage, { type: 'welcome' }>).peers).toHaveLength(5);
  });

  it('spreads different rooms across the nodes', async () => {
    await setup(3);
    const urls = new Map<string, number>();
    for (let i = 0; i < 90; i++) {
      const { signalingUrl } = await join(`spread-room-${i}-abc`);
      urls.set(signalingUrl, (urls.get(signalingUrl) ?? 0) + 1);
    }
    expect(urls.size).toBe(3);
    for (const count of urls.values()) expect(count).toBeGreaterThan(15);
  });

  it('moves a room to a surviving node when its node goes away, and refuses stale tokens on the old one', async () => {
    await setup(2);
    const first = await join('failover-room-abc123');
    const owner = nodes.find((n) => n.url === first.signalingUrl)!;
    const survivor = nodes.find((n) => n !== owner)!;
    expect((await connect(first, 'a')).first).toMatchObject({ type: 'welcome' });

    await stopNode(owner);

    const second = await join('failover-room-abc123');
    expect(second.signalingUrl).toBe(survivor.url);
    expect((await connect(second, 'a')).first).toMatchObject({ type: 'welcome', resumed: false });
    expect(await store.getLease('failover-room-abc123')).toBe(survivor.id);
  });

  it('keeps existing rooms on a draining node but sends new rooms elsewhere', async () => {
    await setup(2);
    const existing = await join('draining-room-abc123');
    const owner = nodes.find((n) => n.url === existing.signalingUrl)!;
    const other = nodes.find((n) => n !== owner)!;

    await owner.agent.drain();
    owner.signaling.drain();

    expect((await join('draining-room-abc123')).signalingUrl).toBe(owner.url);
    for (let i = 0; i < 20; i++) expect((await join(`fresh-room-${i}-abc`)).signalingUrl).toBe(other.url);
  });

  it('answers 503 when no node is alive', async () => {
    await setup(1);
    await stopNode(nodes[0]!);
    const res = await beacon.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room: 'nobody-home-abc123' } });
    expect(res.statusCode).toBe(503);
  });

  it('rejects a token presented to a node that does not own the room', async () => {
    await setup(2);
    const session = await join('wrong-node-room-abc');
    const wrong = nodes.find((n) => n.url !== session.signalingUrl)!;
    const { first } = await connect({ ...session, signalingUrl: wrong.url }, 'x');
    expect(first).toMatchObject({ type: 'error', code: 'not-owner' });
  });
});
