import { JoinResponse, fromBase64Url, isValidRoomSlug, verifyConfig, verifyJoinToken } from '@chillcall/protocol';
import { FakeClock, testKeys } from '@chillcall/testkit';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createBeaconApp, type BeaconOptions } from './app';
import { MemoryPlacementStore } from '@chillcall/placement';

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

describe('tiers and TURN', () => {
  const turn = {
    full: { urls: ['turn:turn.example.com:3478'], secret: 'full-secret' },
    'relay-lite': { urls: ['turn:lite.example.com:3478'], secret: 'lite-secret' },
  };
  const entitlements = async (token: string) => (token === 'paid' ? 'full' : token === 'lite' ? 'relay-lite' : undefined) as 'full' | 'relay-lite' | undefined;
  const turnServers = (body: JoinResponse) => body.iceServers.filter((s) => s.username);

  it('gives free rooms STUN only, even when TURN is configured', async () => {
    await start({ turn, entitlements });
    const body = (await join({ room: 'cozy-room-abc123' })).json() as JoinResponse;
    expect(body.tier).toBe('free');
    expect(body.iceServers).toEqual([{ urls: ['stun:stun.example.com:3478'] }]);
  });

  it('ignores entitlement tokens that do not verify or when no verifier exists', async () => {
    await start({ turn, entitlements });
    const bogus = (await join({ room: 'cozy-room-abc123', entitlement: 'nonsense' })).json() as JoinResponse;
    expect(bogus.tier).toBe('free');
    expect(turnServers(bogus)).toEqual([]);

    await app.close();
    await start({ turn });
    const noVerifier = (await join({ room: 'cozy-room-abc123', entitlement: 'paid' })).json() as JoinResponse;
    expect(noVerifier.tier).toBe('free');
  });

  it('issues time-limited TURN credentials for the entitled tier', async () => {
    await start({ turn, entitlements });
    const body = (await join({ room: 'cozy-room-abc123', entitlement: 'paid' })).json() as JoinResponse;
    expect(body.tier).toBe('full');
    const [server] = turnServers(body);
    expect(server!.urls).toEqual(turn.full.urls);
    expect(server!.username).toBe(`${Math.floor(clock.now / 1000) + 3600}:${body.peerId}`);
    expect(server!.credential).toBe(createHmac('sha1', 'full-secret').update(server!.username!).digest('base64'));
  });

  it('uses the capped pool for relay-lite', async () => {
    await start({ turn, entitlements });
    const body = (await join({ room: 'cozy-room-abc123', entitlement: 'lite' })).json() as JoinResponse;
    expect(body.tier).toBe('relay-lite');
    expect(turnServers(body)[0]!.urls).toEqual(turn['relay-lite'].urls);
  });

  it('extends an owner entitlement to everyone who joins the room, and only that room', async () => {
    await start({ turn, entitlements });
    await join({ room: 'cozy-room-abc123', entitlement: 'paid' });

    const guest = (await join({ room: 'cozy-room-abc123' })).json() as JoinResponse;
    expect(guest.tier).toBe('full');
    expect(turnServers(guest)).toHaveLength(1);
    expect(guest.iceServers.find((s) => s.username)!.username).toContain(guest.peerId);

    const other = (await join({ room: 'another-room-xyz' })).json() as JoinResponse;
    expect(other.tier).toBe('free');
  });

  it('never downgrades a room that already has a better tier', async () => {
    await start({ turn, entitlements });
    await join({ room: 'cozy-room-abc123', entitlement: 'paid' });
    const again = (await join({ room: 'cozy-room-abc123', entitlement: 'lite' })).json() as JoinResponse;
    expect(again.tier).toBe('full');
  });

  it('falls back to STUN when the tier has no pool configured', async () => {
    await start({ turn: { full: turn.full }, entitlements });
    const body = (await join({ room: 'cozy-room-abc123', entitlement: 'lite' })).json() as JoinResponse;
    expect(body.tier).toBe('relay-lite');
    expect(turnServers(body)).toEqual([]);
  });
});

describe('static config', () => {
  it('serves a pre-signed config unchanged', async () => {
    const signed = { kid: 'x', payload: { hello: 'world' }, sig: 'abc' };
    await start({ staticConfig: signed });
    expect((await app.inject({ method: 'GET', url: '/v1/config' })).json()).toEqual(signed);
  });
});
