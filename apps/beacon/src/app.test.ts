import { JoinResponse, fromBase64Url, toBase64Url, isValidRoomSlug, verifyConfig, verifyJoinToken } from '@orvo/protocol';
import { FakeClock, testKeys } from '@orvo/testkit';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createBeaconApp, type BeaconOptions } from './app';
import { Metrics } from '@orvo/metrics';
import { MemoryPlacementStore, ResilientPlacementStore, type PlacementStore } from '@orvo/placement';

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

const join = (body: object, headers: Record<string, string> = { host: 'orvo.example.com' }) =>
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
    expect(body.signalingUrl).toBe('ws://orvo.example.com/ws');
    const checked = verifyJoinToken(body.joinToken, { keys: { [key.kid]: key.publicKey }, nodeId: 'node-1', now: clock.now });
    expect(checked).toMatchObject({ ok: true, payload: { room: 'cozy-room-abc123', peerId: body.peerId } });
  });

  it('uses wss behind a TLS-terminating proxy', async () => {
    await start({ trustProxy: true });
    const res = await join({ room: 'cozy-room-abc123' }, { host: 'orvo.example.com', 'x-forwarded-proto': 'https' });
    expect(res.json().signalingUrl).toBe('wss://orvo.example.com/ws');
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
    const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { host: 'orvo.example.com' } });
    const result = verifyConfig(res.json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
    expect(result).toMatchObject({
      ok: true,
      config: { beaconUrls: ['http://orvo.example.com'], ice: { stunUrls: ['stun:stun.example.com:3478'] } },
    });
  });

  it('keeps publishing earlier public keys so rotation needs no downtime', async () => {
    const old = testKeys('old-1');
    await start({ previousPublicKeys: { [old.kid]: toBase64Url(old.publicKey) } });
    const keys = (await app.inject({ method: 'GET', url: '/v1/keys' })).json();
    expect(Object.keys(keys).sort()).toEqual([key.kid, old.kid].sort());
    expect(fromBase64Url(keys[old.kid])).toEqual(old.publicKey);
    expect(fromBase64Url(keys[key.kid])).toEqual(key.publicKey);
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

  it('gives every room the default tier, with no entitlement', async () => {
    await start({ turn, defaultTier: 'full' });
    const body = (await join({ room: 'cozy-room-abc123' })).json() as JoinResponse;
    expect(body.tier).toBe('full');
    expect(turnServers(body)[0]!.urls).toEqual(turn.full.urls);
  });

  it('falls back to STUN when the tier has no pool configured', async () => {
    await start({ turn: { full: turn.full }, entitlements });
    const body = (await join({ room: 'cozy-room-abc123', entitlement: 'lite' })).json() as JoinResponse;
    expect(body.tier).toBe('relay-lite');
    expect(turnServers(body)).toEqual([]);
  });
});

describe('limits and announcements', () => {
  it('publishes configured limits, tiers and announcement in the signed config', async () => {
    const announcement = { id: 'maint-1', text: 'Maintenance on Friday.' };
    const videoTiers = [{ maxPeers: 3, maxBitrate: 800_000, scaleResolutionDownBy: 1, maxFramerate: 30 }];
    await start({ limits: { maxRoomSize: 4, warnRoomSize: 3, videoTiers }, announcement, minClientVersion: '1.2.0' });
    const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { host: 'orvo.example.com' } });
    const result = verifyConfig(res.json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
    expect(result).toMatchObject({
      ok: true,
      config: { limits: { maxRoomSize: 4, warnRoomSize: 3, videoTiers }, announcement, minClientVersion: '1.2.0' },
    });
  });

  it('puts the room cap in the join token so nodes enforce what clients are told', async () => {
    await start({ limits: { maxRoomSize: 4 } });
    const body = (await join({ room: 'cozy-room-abc123' })).json() as JoinResponse;
    const checked = verifyJoinToken(body.joinToken, { keys: { [key.kid]: key.publicKey }, nodeId: 'node-1', now: clock.now });
    expect(checked).toMatchObject({ ok: true, payload: { maxRoomSize: 4 } });
  });

  it('publishes a Giphy key to clients when one is configured, and nothing otherwise', async () => {
    await start({ integrations: { giphyApiKey: 'web-sdk-key' } });
    const withKey = verifyConfig((await app.inject({ method: 'GET', url: '/v1/config' })).json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
    expect(withKey).toMatchObject({ ok: true, config: { integrations: { giphyApiKey: 'web-sdk-key' } } });

    await app.close();
    await start({ integrations: { giphyApiKey: '' } });
    const without = verifyConfig((await app.inject({ method: 'GET', url: '/v1/config' })).json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
    expect((without as { config: { integrations?: unknown } }).config.integrations).toBeUndefined();
  });

  it('defaults to ten people and no announcement', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    const result = verifyConfig(res.json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
    expect(result).toMatchObject({ ok: true, config: { limits: { maxRoomSize: 10, warnRoomSize: 6 } } });
    expect((result as { config: { announcement?: unknown } }).config.announcement).toBeUndefined();
  });
});

describe('metrics', () => {
  it('counts joins by outcome and tier, and times them', async () => {
    const metrics = new Metrics();
    await start({ metrics, minClientVersion: '1.0.0' });
    await join({ room: 'cozy-room-abc123', clientVersion: '1.0.0' });
    await join({ room: 'cozy-room-abc123', clientVersion: '1.0.0' });
    await join({ room: 'BAD ROOM' });
    await join({ room: 'cozy-room-abc123', clientVersion: '0.1.0' });

    expect(await metrics.value('orvo_beacon_join_requests_total', { result: 'ok' })).toBe(2);
    expect(await metrics.value('orvo_beacon_join_requests_total', { result: 'bad-request' })).toBe(1);
    expect(await metrics.value('orvo_beacon_join_requests_total', { result: 'upgrade-required' })).toBe(1);
    expect(await metrics.value('orvo_beacon_joins_by_tier_total', { tier: 'free' })).toBe(2);
    expect(await metrics.value('orvo_beacon_join_duration_seconds_count')).toBe(4);
  });

  it('counts joins by client version, keeping the label set bounded', async () => {
    const metrics = new Metrics();
    await start({ metrics });
    await join({ room: 'cozy-room-abc123', clientVersion: '1.2.0' });
    await join({ room: 'cozy-room-abc123', clientVersion: '1.2.0' });
    await join({ room: 'cozy-room-abc123', clientVersion: '1.3.1' });
    expect(await metrics.value('orvo_beacon_joins_by_client_version_total', { version: '1.2.0' })).toBe(2);
    expect(await metrics.value('orvo_beacon_joins_by_client_version_total', { version: '1.3.1' })).toBe(1);

    // Versions are client-supplied, so only a limited number of distinct ones become labels; the rest share one.
    for (let i = 0; i < 60; i++) await join({ room: 'cozy-room-abc123', clientVersion: `9.${i}.0` });
    const text = await metrics.render();
    expect(text.match(/orvo_beacon_joins_by_client_version_total\{/g)!.length).toBeLessThanOrEqual(51);
    expect(await metrics.value('orvo_beacon_joins_by_client_version_total', { version: 'other' })).toBeGreaterThanOrEqual(10);
  });

  it('counts no-nodes failures and reports node gauges', async () => {
    const metrics = new Metrics();
    const store = new MemoryPlacementStore([nodes[0]!, { ...nodes[0]!, id: 'node-2', draining: true }]);
    await start({ metrics, store });
    expect(await metrics.value('orvo_beacon_nodes')).toBe(2);
    expect(await metrics.value('orvo_beacon_nodes_draining')).toBe(1);

    await app.close();
    const empty = new Metrics();
    await start({ metrics: empty, store: new MemoryPlacementStore([{ ...nodes[0]!, draining: true }]) });
    await join({ room: 'cozy-room-abc123' });
    expect(await empty.value('orvo_beacon_join_requests_total', { result: 'no-nodes' })).toBe(1);
  });

  it('reports when joins are being served without the shared store', async () => {
    const metrics = new Metrics();
    const inner = new MemoryPlacementStore(nodes);
    let down = false;
    const flaky = new Proxy(inner, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          if (down) throw new Error('connection refused');
          return value.apply(target, args);
        };
      },
    }) as PlacementStore;
    await start({ metrics, store: new ResilientPlacementStore(flaky) });

    expect((await join({ room: 'cozy-room-abc123' })).statusCode).toBe(200);
    expect(await metrics.value('orvo_beacon_placement_degraded')).toBe(0);

    down = true;
    expect((await join({ room: 'cozy-room-abc123' })).statusCode).toBe(200); // still served, from memory
    expect(await metrics.value('orvo_beacon_placement_degraded')).toBe(1);
  });

  it('serves Prometheus text at /metrics, including rooms created', async () => {
    await start();
    await app.inject({ method: 'POST', url: '/v1/rooms' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('orvo_beacon_rooms_created_total 1');
    expect(res.body).toContain('# TYPE orvo_beacon_join_duration_seconds histogram');
  });
});

describe('telemetry', () => {
  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/telemetry', payload: payload as object });
  const batch = (events: object[]) => ({ v: 1, events });

  it('aggregates client reports into metrics without keeping anything per user', async () => {
    const metrics = new Metrics();
    await start({ metrics });
    const res = await post(
      batch([
        { type: 'join', result: 'ok', ms: 1500 },
        { type: 'peer', result: 'connected', route: 'direct', ms: 400 },
        { type: 'peer', result: 'connected', route: 'direct', ms: 600 },
        { type: 'peer', result: 'connected', route: 'relay', ms: 2000 },
        { type: 'peer', result: 'unreachable', route: 'unknown', ms: 25_000 },
        { type: 'reconnect', ok: true, attempts: 2 },
      ]),
    );
    expect(res.statusCode).toBe(204);

    expect(await metrics.value('orvo_client_joins_total', { result: 'ok' })).toBe(1);
    expect(await metrics.value('orvo_client_peer_connections_total', { result: 'connected', route: 'direct' })).toBe(2);
    expect(await metrics.value('orvo_client_peer_connections_total', { result: 'connected', route: 'relay' })).toBe(1);
    expect(await metrics.value('orvo_client_peer_connections_total', { result: 'unreachable' })).toBe(1);
    expect(await metrics.value('orvo_client_peer_connect_seconds_count', { route: 'direct' })).toBe(2);
    expect(await metrics.value('orvo_client_peer_connect_seconds_sum', { route: 'direct' })).toBeCloseTo(1.0);
    expect(await metrics.value('orvo_client_signaling_reconnects_total', { ok: 'true' })).toBe(1);
  });

  it('rejects malformed, oversize and too-large batches', async () => {
    await start();
    expect((await post({ v: 1, events: [{ type: 'mystery' }] })).statusCode).toBe(400);
    expect((await post('nonsense')).statusCode).toBe(415); // neither JSON nor text/plain
    const plain = (body: string) => app.inject({ method: 'POST', url: '/v1/telemetry', payload: body, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    expect((await plain('not json')).statusCode).toBe(400);
    expect((await post(batch(Array(51).fill({ type: 'reconnect', ok: true, attempts: 1 })))).statusCode).toBe(400);
    expect((await post({ v: 1, events: [], padding: 'x'.repeat(9000) })).statusCode).toBe(413);
  });

  it('accepts the same batch as text/plain, which is how a closing page sends it', async () => {
    const metrics = new Metrics();
    await start({ metrics });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telemetry',
      payload: JSON.stringify(batch([{ type: 'join', result: 'ok', ms: 10 }])),
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
    expect(res.statusCode).toBe(204);
    expect(await metrics.value('orvo_client_joins_total', { result: 'ok' })).toBe(1);
  });

  it('ignores identifying fields rather than recording them', async () => {
    const metrics = new Metrics();
    await start({ metrics });
    await post(batch([{ type: 'peer', result: 'connected', route: 'direct', ms: 1, room: 'secret-room', name: 'Ann' }]));
    const text = await metrics.render();
    expect(text).not.toContain('secret-room');
    expect(text).not.toContain('Ann');
  });

  it('is rate limited like the other endpoints', async () => {
    await start({ rateLimitPerMinute: 2 });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(batch([]))).statusCode);
    expect(codes).toEqual([204, 204, 429, 429]);
  });
});

describe('static config', () => {
  it('serves a pre-signed config unchanged', async () => {
    const signed = { kid: 'x', payload: { hello: 'world' }, sig: 'abc' };
    await start({ staticConfig: signed });
    expect((await app.inject({ method: 'GET', url: '/v1/config' })).json()).toEqual(signed);
  });
});
