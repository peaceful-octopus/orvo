import { MAX_FRAME_BYTES, parseServerMessage, type ServerMessage } from '@chillcall/protocol';
import { FakeClock, makeJoinToken, testKeys } from '@chillcall/testkit';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { SignalingServer, type SignalingOptions } from './server';

const keys = testKeys();
const clock = new FakeClock();
const ROOM = 'test-room-abc123';

let server: http.Server;
let signaling: SignalingServer;
let sockets: WebSocket[] = [];

async function start(opts: Partial<SignalingOptions> = {}) {
  signaling = new SignalingServer({ nodeId: 'node-1', keys: keys.keys, now: () => clock.now, resumeGraceMs: 150, ...opts });
  server = http.createServer();
  signaling.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
}

afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets = [];
  signaling.close();
  await new Promise((resolve) => server.close(resolve));
});

interface Client {
  ws: WebSocket;
  messages: ServerMessage[];
  closed: Promise<{ code: number }>;
  send(msg: object): void;
  next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>>;
}

function connect(): Client {
  const { port } = server.address() as AddressInfo;
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  sockets.push(ws);
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (data) => {
    const parsed = parseServerMessage(String(data));
    if (parsed.ok) messages.push(parsed.message);
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<{ code: number }>((resolve) => ws.on('close', (code) => resolve({ code })));
  const opened = new Promise<void>((resolve) => ws.on('open', resolve));
  return {
    ws,
    messages,
    closed,
    send: (msg) => void opened.then(() => ws.send(JSON.stringify({ v: 1, ...msg }))),
    async next(type) {
      for (let i = 0; i < 200; i++) {
        const index = messages.findIndex((m) => m.type === type);
        if (index >= 0) return messages.splice(index, 1)[0] as never;
        await Promise.race([new Promise<void>((r) => waiters.push(r)), new Promise((r) => setTimeout(r, 25))]);
      }
      throw new Error(`timed out waiting for ${type}; got ${JSON.stringify(messages)}`);
    },
  };
}

async function join(peerId: string, name = peerId, room = ROOM) {
  const client = connect();
  client.send({ type: 'join', token: makeJoinToken(keys, { room, peerId }, clock.now), name });
  const welcome = await client.next('welcome');
  return { client, welcome };
}

describe('joining', () => {
  it('welcomes the first member and announces later ones', async () => {
    await start();
    const a = await join('a');
    expect(a.welcome).toMatchObject({ peerId: 'a', peers: [], status: 'ok', resumed: false });

    const b = await join('b');
    expect(b.welcome.peers).toEqual([{ id: 'a', name: 'a' }]);
    expect(await a.client.next('peer-joined')).toMatchObject({ peer: { id: 'b', name: 'b' } });
  });

  it('rejects bad, expired, misrouted and replayed tokens', async () => {
    await start();
    const other = testKeys();
    const cases: [string, string][] = [
      [makeJoinToken(other, { room: ROOM }, clock.now), 'bad-token'],
      [makeJoinToken(keys, { room: ROOM, exp: clock.now - 1 }, clock.now), 'bad-token'],
      [makeJoinToken(keys, { room: ROOM, nodeId: 'node-2' }, clock.now), 'not-owner'],
      ['garbage', 'bad-token'],
    ];
    for (const [token, code] of cases) {
      const c = connect();
      c.send({ type: 'join', token, name: 'x' });
      expect(await c.next('error')).toMatchObject({ code });
      expect((await c.closed).code).toBe(1008);
    }

    const token = makeJoinToken(keys, { room: ROOM, peerId: 'r' }, clock.now);
    const first = connect();
    first.send({ type: 'join', token, name: 'r' });
    await first.next('welcome');
    const replay = connect();
    replay.send({ type: 'join', token, name: 'r' });
    expect(await replay.next('error')).toMatchObject({ code: 'bad-token' });
  });

  it('refuses the 11th member with room-full', async () => {
    await start();
    for (let n = 0; n < 10; n++) await join(`p${n}`);
    const late = connect();
    late.send({ type: 'join', token: makeJoinToken(keys, { room: ROOM, peerId: 'late' }, clock.now), name: 'late' });
    expect(await late.next('error')).toMatchObject({ code: 'room-full' });
    expect(await signaling.metrics.value('chillcall_signaling_join_failures_total', { code: 'room-full' })).toBe(1);
  });

  it('enforces the room cap carried in the join token, but never above the hard limit', async () => {
    await start({ hardMaxRoomSize: 5 });
    for (let n = 0; n < 2; n++) {
      const c = connect();
      c.send({ type: 'join', token: makeJoinToken(keys, { room: ROOM, peerId: `p${n}`, maxRoomSize: 2 }, clock.now), name: 'x' });
      await c.next('welcome');
    }
    const third = connect();
    third.send({ type: 'join', token: makeJoinToken(keys, { room: ROOM, peerId: 'p2', maxRoomSize: 2 }, clock.now), name: 'x' });
    expect(await third.next('error')).toMatchObject({ code: 'room-full' });

    // A token asking for more than the node's hard limit is clamped to it.
    for (let n = 0; n < 5; n++) {
      const c = connect();
      c.send({ type: 'join', token: makeJoinToken(keys, { room: 'big-room-abc123', peerId: `b${n}`, maxRoomSize: 50 }, clock.now), name: 'x' });
      await c.next('welcome');
    }
    const sixth = connect();
    sixth.send({ type: 'join', token: makeJoinToken(keys, { room: 'big-room-abc123', peerId: 'b5', maxRoomSize: 50 }, clock.now), name: 'x' });
    expect(await sixth.next('error')).toMatchObject({ code: 'room-full' });
  });

  it('reports degraded status above six members', async () => {
    await start();
    for (let n = 0; n < 6; n++) await join(`p${n}`);
    expect((await join('p6')).welcome.status).toBe('degraded');
  });

  it('requires join as the first message and closes idle connections', async () => {
    await start({ joinTimeoutMs: 100 });
    const wrongFirst = connect();
    wrongFirst.send({ type: 'signal', to: 'x', payload: {} });
    expect(await wrongFirst.next('error')).toMatchObject({ code: 'bad-request' });

    const idle = connect();
    expect((await idle.closed).code).toBe(1008);
  });

  it('keeps rooms separate', async () => {
    await start();
    await join('a', 'a', 'room-one-aaa');
    const b = await join('b', 'b', 'room-two-bbb');
    expect(b.welcome.peers).toEqual([]);
  });
});

describe('relay and limits', () => {
  it('relays signals between members of a room and drops others', async () => {
    await start();
    const a = await join('a');
    const b = await join('b');
    await a.client.next('peer-joined');

    a.client.send({ type: 'signal', to: 'b', payload: { sdp: 'offer' } });
    expect(await b.client.next('signal')).toMatchObject({ from: 'a', payload: { sdp: 'offer' } });

    a.client.send({ type: 'signal', to: 'nobody', payload: {} });
    await new Promise((r) => setTimeout(r, 50));
    expect(await signaling.metrics.value('chillcall_signaling_signals_dropped_total')).toBe(1);
  });

  it('closes connections that send oversize frames', async () => {
    await start();
    const { client } = await join('a');
    client.send({ type: 'signal', to: 'b', payload: 'x'.repeat(MAX_FRAME_BYTES) });
    expect((await client.closed).code).toBe(1009);
  });

  it('rate limits chatty connections', async () => {
    await start({ rate: { burst: 5, perSecond: 1 } });
    const { client } = await join('a');
    for (let i = 0; i < 10; i++) client.send({ type: 'ping' });
    expect(await client.next('error')).toMatchObject({ code: 'rate-limited' });
    expect((await client.closed).code).toBe(1008);
  });
});

describe('leaving, resuming and draining', () => {
  it('announces an intentional leave immediately', async () => {
    await start();
    const a = await join('a');
    const b = await join('b');
    await a.client.next('peer-joined');
    b.client.ws.close(1000);
    expect(await a.client.next('peer-left')).toMatchObject({ id: 'b' });
  });

  it('keeps a dropped member for the grace period and announces the leave afterwards', async () => {
    await start({ resumeGraceMs: 100 });
    const a = await join('a');
    const b = await join('b');
    await a.client.next('peer-joined');
    b.client.ws.terminate();
    await new Promise((r) => setTimeout(r, 40));
    expect(a.client.messages.find((m) => m.type === 'peer-left')).toBeUndefined();
    expect(await a.client.next('peer-left')).toMatchObject({ id: 'b' });
  });

  it('resumes under the same peer id without notifying other members', async () => {
    await start({ resumeGraceMs: 500 });
    const a = await join('a');
    const b = await join('b');
    await a.client.next('peer-joined');
    b.client.ws.terminate();

    const again = await join('b');
    expect(again.welcome.peers).toEqual([{ id: 'a', name: 'a' }]);
    expect(again.welcome.resumed).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.client.messages.filter((m) => m.type === 'peer-left' || m.type === 'peer-joined')).toEqual([]);
    expect(await signaling.metrics.value('chillcall_signaling_resumes_total')).toBe(1);
  });

  it('while draining refuses new rooms but keeps serving existing ones, including new and returning members', async () => {
    await start();
    const a = await join('a');
    const b = await join('b');
    await a.client.next('peer-joined');
    signaling.drain();

    // A new room is refused...
    const fresh = connect();
    fresh.send({ type: 'join', token: makeJoinToken(keys, { room: 'brand-new-room-abc', peerId: 'x' }, clock.now), name: 'x' });
    expect(await fresh.next('error')).toMatchObject({ code: 'draining' });

    // ...but a newcomer to a room that already exists is admitted, and calls carry on.
    const c = connect();
    c.send({ type: 'join', token: makeJoinToken(keys, { room: ROOM, peerId: 'c' }, clock.now), name: 'c' });
    expect(await c.next('welcome')).toMatchObject({ peerId: 'c' });
    expect(await a.client.next('peer-joined')).toMatchObject({ peer: { id: 'c' } });

    a.client.send({ type: 'signal', to: 'b', payload: { ok: true } });
    expect(await b.client.next('signal')).toMatchObject({ from: 'a' });
  });

  it('lets a member who dropped reconnect while the node is draining', async () => {
    await start({ resumeGraceMs: 1000 });
    const a = await join('a');
    await join('b');
    await a.client.next('peer-joined');
    signaling.drain();

    a.client.ws.terminate();
    const again = connect();
    again.send({ type: 'join', token: makeJoinToken(keys, { room: ROOM, peerId: 'a' }, clock.now), name: 'a' });
    expect(await again.next('welcome')).toMatchObject({ peerId: 'a', resumed: true });
  });

  it('exposes metrics in Prometheus text format', async () => {
    await start();
    await join('a');
    const text = await signaling.renderMetrics();
    expect(text).toContain('chillcall_signaling_connections 1');
    expect(text).toContain('chillcall_signaling_rooms 1');
    expect(text).toContain('chillcall_signaling_joins_total 1');
    expect(text).toContain('chillcall_signaling_members 1');
    expect(text).toContain('# TYPE chillcall_signaling_joins_total counter');
  });
});

describe('removing people (kicking)', () => {
  async function joinAs(peerId: string, overrides: Record<string, unknown> = {}) {
    const client = connect();
    client.send({ type: 'join', token: makeJoinToken(keys, { room: ROOM, peerId, ...overrides }, clock.now), name: peerId });
    return client;
  }
  const owner = (peerId = 'owner') => joinAs(peerId, { owner: true, acct: 'acct-owner' });

  it('lets the owner remove someone: they are told, disconnected, and everyone else is told they left', async () => {
    await start();
    const boss = await owner();
    await boss.next('welcome');
    const bob = await joinAs('bob');
    await bob.next('welcome');
    const cy = await joinAs('cy');
    await cy.next('welcome');
    await boss.next('peer-joined');
    await boss.next('peer-joined');

    boss.send({ type: 'kick', peerId: 'bob' });
    await bob.next('kicked');
    expect((await bob.closed).code).toBe(4003);
    expect(await boss.next('peer-left')).toMatchObject({ id: 'bob' });
    expect(await cy.next('peer-left')).toMatchObject({ id: 'bob' });
  });

  it('refuses a kick from anyone but the owner, and removes nobody', async () => {
    await start();
    const boss = await owner();
    await boss.next('welcome');
    const bob = await joinAs('bob');
    await bob.next('welcome');
    const cy = await joinAs('cy');
    await cy.next('welcome');
    await boss.next('peer-joined');
    await boss.next('peer-joined');

    bob.send({ type: 'kick', peerId: 'cy' });
    expect(await bob.next('error')).toMatchObject({ code: 'forbidden' });
    // Nothing happened to Cy: still connected, and no one was told they left.
    cy.send({ type: 'signal', to: 'owner', payload: 'still here' });
    expect(await boss.next('signal')).toMatchObject({ from: 'cy', payload: 'still here' });
    expect(boss.messages.some((m) => m.type === 'peer-left')).toBe(false);
  });

  it('keeps a removed person out under the same peer id, and a removed account out under any peer id', async () => {
    await start();
    const boss = await owner();
    await boss.next('welcome');
    const bob = await joinAs('bob', { acct: 'acct-bob' });
    await bob.next('welcome');
    await boss.next('peer-joined');
    boss.send({ type: 'kick', peerId: 'bob' });
    await bob.next('kicked');

    const sameId = await joinAs('bob', { acct: 'acct-bob' });
    expect(await sameId.next('error')).toMatchObject({ code: 'kicked' });
    const newId = await joinAs('bob-again', { acct: 'acct-bob' }); // signing in again does not help
    expect(await newId.next('error')).toMatchObject({ code: 'kicked' });
    const somebodyElse = await joinAs('dee', { acct: 'acct-dee' });
    expect(await somebodyElse.next('welcome')).toMatchObject({ peerId: 'dee' });
  });

  it('cannot tell a guest from the next guest, so a removed guest can only be kept out by their peer id', async () => {
    await start();
    const boss = await owner();
    await boss.next('welcome');
    const guest = await joinAs('guest-1');
    await guest.next('welcome');
    await boss.next('peer-joined');
    boss.send({ type: 'kick', peerId: 'guest-1' });
    await guest.next('kicked');
    const fresh = await joinAs('guest-2'); // a new identity: this is what locking the room is for
    expect(await fresh.next('welcome')).toMatchObject({ peerId: 'guest-2' });
  });

  it('removes a member who has dropped and is waiting to reconnect', async () => {
    await start({ resumeGraceMs: 5_000 });
    const boss = await owner();
    await boss.next('welcome');
    const bob = await joinAs('bob');
    await bob.next('welcome');
    await boss.next('peer-joined');
    bob.ws.terminate();
    await bob.closed;
    boss.send({ type: 'kick', peerId: 'bob' });
    expect(await boss.next('peer-left')).toMatchObject({ id: 'bob' });
    const back = await joinAs('bob');
    expect(await back.next('error')).toMatchObject({ code: 'kicked' });
  });

  it('ignores a kick of someone who is not there, or of oneself', async () => {
    await start();
    const boss = await owner();
    await boss.next('welcome');
    boss.send({ type: 'kick', peerId: 'nobody' });
    boss.send({ type: 'kick', peerId: 'owner' });
    boss.send({ type: 'signal', to: 'nobody', payload: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(boss.ws.readyState).toBe(WebSocket.OPEN);
    expect(boss.messages).toEqual([]);
  });

  it('forgets who was removed once the room has emptied', async () => {
    await start();
    const boss = await owner();
    await boss.next('welcome');
    const bob = await joinAs('bob');
    await bob.next('welcome');
    await boss.next('peer-joined');
    boss.send({ type: 'kick', peerId: 'bob' });
    await bob.next('kicked');
    boss.ws.close(1000);
    await boss.closed;
    await new Promise((r) => setTimeout(r, 100));
    const later = await joinAs('bob');
    expect(await later.next('welcome')).toMatchObject({ peerId: 'bob' });
  });
});
