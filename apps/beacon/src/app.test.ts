import { JoinResponse, fromBase64Url, isValidRoomSlug, verifyConfig, verifyJoinToken } from '@chillcall/protocol';
import { FakeClock, testKeys } from '@chillcall/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { createBeaconApp, type BeaconOptions } from './app';
import { MemoryPlacementStore } from './placement';

const key = testKeys('beacon-1');
const clock = new FakeClock();
const nodes = [{ id: 'node-1', region: 'r', weight: 1, draining: false }];

let app: Awaited<ReturnType<typeof createBeaconApp>>;

async function start(extra: Partial<BeaconOptions> = {}) {
  app = await createBeaconApp({
    signingKey: { kid: key.kid, publicKey: key.publicKey, secretKey: key.secretKey },
    store: new MemoryPlacementStore(nodes, () => clock.now),
    stunUrls: ['stun:stun.example.com:3478'],
    now: () => clock.now,
    rateLimitPerMinute: false,
    ...extra,
  });
  return app;
}

afterEach(() => app.close());

const join = (body: object, headers: Record<string, string> = { host: 'chill.example.com' }) =>
  app.inject({ method: 'POST', url: '/v1/rooms/join', payload: body, headers });

describe('rooms', () => {
  it('creates unguessable room ids', async () => {
    await start();
    const res = await app.inject({ method: 'POST', url: '/v1/rooms' });
    expect(isValidRoomSlug(res.json().room)).toBe(true);
    expect(res.json().room.split('-').length).toBeGreaterThanOrEqual(4);
  });

  it('issues a join token the placed node accepts, plus STUN servers and the free tier', async () => {
    await start();
    const res = await join({ room: 'cozy-room-abc123' });
    expect(res.statusCode).toBe(200);
    const body = JoinResponse.parse(res.json());

    expect(body).toMatchObject({ transport: 'mesh', tier: 'free', iceServers: [{ urls: ['stun:stun.example.com:3478'] }] });
    expect(body.signalingUrl).toBe('ws://chill.example.com/ws');
    const checked = verifyJoinToken(body.joinToken, { keys: { [key.kid]: key.publicKey }, nodeId: 'node-1', now: clock.now });
    expect(checked).toMatchObject({ ok: true, payload: { room: 'cozy-room-abc123', peerId: body.peerId } });
  });

  it('uses wss behind a TLS-terminating proxy', async () => {
    await start({ trustProxy: true });
    const res = await join({ room: 'cozy-room-abc123' }, { host: 'chill.example.com', 'x-forwarded-proto': 'https' });
    expect(res.json().signalingUrl).toBe('wss://chill.example.com/ws');
  });

  it('uses the node url when the node has one', async () => {
    await start({ store: new MemoryPlacementStore([{ ...nodes[0]!, url: 'wss://n1.example.com/ws' }]) });
    expect((await join({ room: 'cozy-room-abc123' })).json().signalingUrl).toBe('wss://n1.example.com/ws');
  });

  it('gives each joiner a fresh peer id and lets a resume token keep it', async () => {
    await start();
    const first = (await join({ room: 'cozy-room-abc123' })).json() as JoinResponse;
    const other = (await join({ room: 'cozy-room-abc123' })).json() as JoinResponse;
    expect(other.peerId).not.toBe(first.peerId);

    const again = (await join({ room: 'cozy-room-abc123', resume: first.resumeToken })).json() as JoinResponse;
    expect(again.peerId).toBe(first.peerId);

    const wrongRoom = (await join({ room: 'another-room-xyz', resume: first.resumeToken })).json() as JoinResponse;
    expect(wrongRoom.peerId).not.toBe(first.peerId);
  });

  it('rejects malformed requests and unsupported clients', async () => {
    await start({ minClientVersion: '1.0.0' });
    expect((await join({ room: 'BAD ROOM' })).statusCode).toBe(400);
    expect((await join({})).statusCode).toBe(400);
    const old = await join({ room: 'cozy-room-abc123', clientVersion: '0.9.0' });
    expect(old.statusCode).toBe(426);
    expect(old.json().code).toBe('upgrade-required');
    expect((await join({ room: 'cozy-room-abc123', clientVersion: '1.0.0' })).statusCode).toBe(200);
  });

  it('returns 503 when no node can take the room', async () => {
    await start({ store: new MemoryPlacementStore([{ ...nodes[0]!, draining: true }]) });
    expect((await join({ room: 'cozy-room-abc123' })).statusCode).toBe(503);
  });
});

describe('config and keys', () => {
  it('serves a signed config that verifies and points back at the beacon', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { host: 'chill.example.com' } });
    const result = verifyConfig(res.json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
    expect(result).toMatchObject({
      ok: true,
      config: { beaconUrls: ['http://chill.example.com'], ice: { stunUrls: ['stun:stun.example.com:3478'] } },
    });
  });

  it('publishes its public key', async () => {
    await start();
    const keys = (await app.inject({ method: 'GET', url: '/v1/keys' })).json();
    expect(fromBase64Url(keys[key.kid])).toEqual(key.publicKey);
  });
});

describe('rate limiting', () => {
  it('returns 429 once a client exceeds its budget', async () => {
    await start({ rateLimitPerMinute: 3 });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await join({ room: 'cozy-room-abc123' })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
});
