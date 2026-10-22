import { generateRoomId } from '@chillcall/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { SimClient, type SimReporter } from './client';
import { runLoad } from './run';
import { startHarness, type Harness } from './testing';

// Failure drills against a beacon and several signaling nodes over real HTTP and WebSockets. Set REDIS_URL to
// run them against a real Redis instead of the in-memory stand-in.

let harness: Harness;
let clients: SimClient[] = [];

afterEach(async () => {
  for (const c of clients) c.stop();
  clients = [];
  await harness?.close();
});

function makeReporter() {
  const log = {
    joinFailures: [] as string[],
    reconnects: [] as { ms: number; attempts: number }[],
    signalsReceived: 0,
    signalsSent: 0,
  };
  const reporter: SimReporter = {
    joinOk: () => {},
    joinFailed: (reason) => void log.joinFailures.push(reason),
    reconnected: (ms, attempts) => void log.reconnects.push({ ms, attempts }),
    signalRtt: () => {},
    signalsSent: (n) => void (log.signalsSent += n),
    signalsReceived: (n) => void (log.signalsReceived += n),
  };
  return { log, reporter };
}

async function waitUntil(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** Starts `rooms` rooms of `size` people each and waits until everyone is in. */
async function populate(h: Harness, rooms: number, size: number, reporter: SimReporter) {
  const made: { room: string; members: SimClient[] }[] = [];
  for (let r = 0; r < rooms; r++) {
    const room = generateRoomId();
    const members: SimClient[] = [];
    for (let i = 0; i < size; i++) {
      const client = new SimClient({ beaconUrl: h.beaconUrl, room, name: `p${r}-${i}`, reporter });
      await client.start();
      members.push(client);
      clients.push(client);
    }
    made.push({ room, members });
  }
  return made;
}

const connectedCount = (h: Harness) =>
  h.nodes.filter((n) => n.alive).reduce((sum, n) => sum + n.signaling.stats().connections, 0);

const busiest = (h: Harness) =>
  h.nodes.reduce((a, b) => (a.signaling.stats().connections >= b.signaling.stats().connections ? a : b));

async function nodeFor(h: Harness, room: string): Promise<string> {
  const res = await fetch(new URL('/v1/rooms/join', h.beaconUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room }),
  });
  return ((await res.json()) as { signalingUrl: string }).signalingUrl;
}

describe('load', () => {
  it('a short scenario across three nodes joins everyone, relays every signal and reports no problems', async () => {
    harness = await startHarness({ nodes: 3 });
    const report = await runLoad({ beaconUrl: harness.beaconUrl, users: 60, rampSeconds: 2, holdSeconds: 3, seed: 4 });

    expect(report.problems).toEqual([]);
    expect(report.joinsOk).toBe(60);
    expect(report.joinFailures).toEqual({});
    expect(report.signalsSent).toBeGreaterThan(100);
    expect(report.signalsReceived).toBe(report.signalsSent); // nothing lost on the way through the nodes
    expect(report.signalRttMs.count).toBeGreaterThan(0);
  }, 60_000);
});

describe('node failure', () => {
  it('clients of a node that shuts down cleanly reconnect through the beacon within seconds', async () => {
    harness = await startHarness({ nodes: 3 });
    const { log, reporter } = makeReporter();
    const rooms = await populate(harness, 9, 4, reporter);
    const total = rooms.length * 4;

    const victim = busiest(harness);
    const affected = victim.signaling.stats().connections;
    expect(affected).toBeGreaterThan(0);
    const idsBefore = new Map(clients.map((c) => [c, c.peerId]));

    await harness.killNode(victim.id, 'clean');

    await waitUntil(
      'everyone back on a surviving node',
      () => connectedCount(harness) === total && clients.every((c) => c.state === 'connected'),
    );
    expect(log.reconnects).toHaveLength(affected);
    expect(Math.max(...log.reconnects.map((r) => r.ms))).toBeLessThan(10_000);
    expect(log.joinFailures).toEqual([]);
    for (const c of clients) expect(c.peerId).toBe(idsBefore.get(c)); // resume tokens keep identities
    expect(victim.signaling.stats().connections).toBe(0);
  }, 60_000);

  it('survives a crash: rooms move once the dead node registration expires', async () => {
    harness = await startHarness({ nodes: 3, nodeTtlMs: 1500, heartbeatMs: 300 });
    const { log, reporter } = makeReporter();
    const rooms = await populate(harness, 6, 3, reporter);
    const total = rooms.length * 3;

    const victim = busiest(harness);
    const affected = victim.signaling.stats().connections;
    await harness.killNode(victim.id, 'crash');

    await waitUntil(
      'everyone reconnected after the registration expired',
      () => connectedCount(harness) === total && clients.every((c) => c.state === 'connected'),
      30_000,
    );
    // Exactly one successful reconnect per stranded client: failed attempts against the dead node must not spawn
    // extra reconnect loops (they once did, and each loop resumed and replaced the others' connections).
    expect(log.reconnects).toHaveLength(affected);
    expect(log.reconnects.every((r) => r.ms < 15_000)).toBe(true);
    expect(log.joinFailures).toEqual([]);

    // Every room is again on exactly one node, and none is on the dead one.
    for (const room of rooms) expect(new Set(room.members.map((m) => m.nodeUrl)).size).toBe(1);
    expect(clients.some((c) => c.nodeUrl === victim.url)).toBe(false);
  }, 90_000);
});

describe('rolling restart', () => {
  it('draining keeps calls and returning members working, steers new rooms away, then moves everyone cleanly', async () => {
    harness = await startHarness({ nodes: 3 });
    const { log, reporter } = makeReporter();
    const rooms = await populate(harness, 6, 3, reporter);

    const victim = busiest(harness);
    const hosted = rooms.filter((r) => r.members[0]!.nodeUrl === victim.url);
    expect(hosted.length).toBeGreaterThan(0);

    await harness.drainNode(victim.id);

    // New rooms avoid the draining node.
    for (let i = 0; i < 10; i++) expect(await nodeFor(harness, generateRoomId())).not.toBe(victim.url);

    // A newcomer to a room it hosts is still admitted there, and sees the people already in the call.
    const newcomer = new SimClient({ beaconUrl: harness.beaconUrl, room: hosted[0]!.room, name: 'late', reporter });
    await newcomer.start();
    clients.push(newcomer);
    expect(newcomer.nodeUrl).toBe(victim.url);
    expect(newcomer.welcomePeers).toBe(3);

    // A member whose connection drops while draining gets back in with the same identity.
    const returning = hosted[0]!.members[0]!;
    const id = returning.peerId;
    returning.sever();
    await waitUntil('returning member reconnected', () => returning.state === 'connected' && log.reconnects.length > 0);
    expect(returning.peerId).toBe(id);

    // Finally the node goes away; everyone it hosted lands on the others.
    await harness.killNode(victim.id, 'clean');
    await waitUntil(
      'all clients connected elsewhere',
      () => clients.every((c) => c.state === 'connected') && victim.signaling.stats().connections === 0,
    );
    expect(connectedCount(harness)).toBe(clients.length);
    expect(log.joinFailures).toEqual([]);
  }, 60_000);
});

describe('Redis outage', () => {
  it('keeps connected calls running and keeps placing joins on the right nodes', async () => {
    harness = await startHarness({ nodes: 3 });
    const { log, reporter } = makeReporter();
    const rooms = await populate(harness, 6, 3, reporter);
    const placedBefore = await Promise.all(rooms.map((r) => nodeFor(harness, r.room)));

    harness.redis.down = true;

    // Nobody is dropped.
    await new Promise((r) => setTimeout(r, 2500));
    expect(clients.every((c) => c.state === 'connected')).toBe(true);
    expect(log.reconnects).toEqual([]);

    // Existing rooms still resolve to the nodes that host them; a newcomer finds the people already there.
    const placedDuring = await Promise.all(rooms.map((r) => nodeFor(harness, r.room)));
    expect(placedDuring).toEqual(placedBefore);
    const newcomer = new SimClient({ beaconUrl: harness.beaconUrl, room: rooms[0]!.room, name: 'during-outage', reporter });
    await newcomer.start();
    clients.push(newcomer);
    expect(newcomer.welcomePeers).toBe(3);

    // Brand new rooms can still be created, and stay put.
    const fresh = generateRoomId();
    const first = await nodeFor(harness, fresh);
    expect(await nodeFor(harness, fresh)).toBe(first);
    const lone = new SimClient({ beaconUrl: harness.beaconUrl, room: fresh, name: 'new-room', reporter });
    await lone.start();
    clients.push(lone);

    // When Redis returns, rooms have not moved.
    harness.redis.down = false;
    const placedAfter = await Promise.all(rooms.map((r) => nodeFor(harness, r.room)));
    expect(placedAfter).toEqual(placedBefore);
    expect(log.joinFailures).toEqual([]);
  }, 60_000);
});

describe('beacon outage', () => {
  it('leaves connected calls alone, and a client that drops meanwhile rejoins once the beacon is back', async () => {
    harness = await startHarness({ nodes: 2 });
    const { log, reporter } = makeReporter();
    const rooms = await populate(harness, 3, 3, reporter);
    const victim = rooms[0]!.members[0]!;
    const id = victim.peerId;

    await harness.stopBeacon();
    await new Promise((r) => setTimeout(r, 1500));
    expect(clients.every((c) => c.state === 'connected')).toBe(true);

    victim.sever();
    await new Promise((r) => setTimeout(r, 3000));
    expect(victim.state).toBe('reconnecting'); // cannot ask the beacon, keeps trying
    expect(clients.filter((c) => c !== victim).every((c) => c.state === 'connected')).toBe(true);

    await harness.startBeacon();
    await waitUntil('dropped client back', () => victim.state === 'connected', 20_000);
    expect(victim.peerId).toBe(id);
    expect(log.reconnects).toHaveLength(1);
    expect(log.joinFailures).toEqual([]);
  }, 60_000);
});
