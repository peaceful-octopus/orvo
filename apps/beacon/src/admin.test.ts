import { JoinResponse, verifyConfig } from '@orvo/protocol';
import { MemoryPlacementStore } from '@orvo/placement';
import { FakeClock, testKeys } from '@orvo/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { adminTokenValid, cameThroughProxy, isLocalAddress, issueAdminToken, passwordMatches, registerAdminRoutes, type AdminOptions } from './admin';
import { createBeaconApp } from './app';
import { SettingsStore, settingsFromEnv } from './settings';

const key = testKeys('beacon-1');
const signingKey = { kid: key.kid, publicKey: key.publicKey, secretKey: key.secretKey };
const clock = new FakeClock();
const PASSWORD = 'correct horse battery staple';
const LAN = '192.168.0.20';

let app: Awaited<ReturnType<typeof createBeaconApp>>;
let store: SettingsStore;

async function start(extra: Partial<AdminOptions> = {}, register = true) {
  store = new SettingsStore({ defaults: settingsFromEnv({}, { roomCreation: 'anyone', defaultRoomAccess: 'anyone' }), authConfigured: false });
  app = await createBeaconApp({
    signingKey,
    store: new MemoryPlacementStore([{ id: 'node-1', region: 'r', weight: 1, draining: false }], () => clock.now),
    stunUrls: store.effective().stunUrls,
    live: () => store.live(),
    now: () => clock.now,
    rateLimitPerMinute: false,
  });
  if (register) await registerAdminRoutes(app, { store, password: PASSWORD, signingKey, now: () => clock.now, ...extra });
  return app;
}

afterEach(() => app?.close());

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, opts: { token?: string; payload?: object; from?: string; headers?: Record<string, string> } = {}) =>
  app.inject({
    method,
    url,
    payload: opts.payload,
    remoteAddress: opts.from ?? LAN,
    headers: { host: 'orvo.example.com', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
  });

const login = async () => ((await call('POST', '/v1/admin/login', { payload: { password: PASSWORD } })).json() as { token: string }).token;
const config = async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/config' });
  const result = verifyConfig(res.json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
  if (!result.ok) throw new Error(result.reason);
  return result.config;
};
const joinRoom = (room: string) => app.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room }, headers: { host: 'orvo.example.com' } });

describe('address checks', () => {
  it('treats loopback, private, link-local and unique-local addresses as local, however they are written', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.0.53', '169.254.1.1', '::1', 'fe80::1', 'fd12:3456::1', 'fc00::1', '::ffff:192.168.0.5', '::ffff:127.0.0.1']) {
      expect(isLocalAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '65.128.135.123', '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.64.0.1', '2001:db8::1', '::ffff:8.8.8.8', 'not an address', '', undefined]) {
      expect(isLocalAddress(ip), String(ip)).toBe(false);
    }
  });

  it('recognises the headers a reverse proxy adds', () => {
    expect(cameThroughProxy({ host: 'a' })).toBe(false);
    for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'x-forwarded-host']) expect(cameThroughProxy({ [name]: 'x' }), name).toBe(true);
  });
});

describe('passwords and tokens', () => {
  it('compares passwords exactly, whatever their length', () => {
    expect(passwordMatches('abc', 'abc')).toBe(true);
    for (const wrong of ['abd', 'ab', 'abcd', '', undefined, 5, null]) expect(passwordMatches(wrong, 'abc')).toBe(false);
  });

  it('accepts a token until it expires, and not after the password or the key changes', () => {
    const { token, expiresAt } = issueAdminToken(signingKey, 'pw', 1000);
    expect(adminTokenValid(token, signingKey, 'pw', 1001)).toBe(true);
    expect(adminTokenValid(token, signingKey, 'pw', expiresAt)).toBe(false);
    expect(adminTokenValid(token, signingKey, 'other', 1001)).toBe(false);
    expect(adminTokenValid(token, testKeys('another'), 'pw', 1001)).toBe(false);
  });

  it('rejects tokens that are damaged or forged', () => {
    const { token } = issueAdminToken(signingKey, 'pw', 1000);
    const [payload] = token.split('.') as [string];
    const forged = Buffer.from(JSON.stringify({ exp: 9e15 })).toString('base64url');
    for (const bad of ['', 'x', 'x.y', `${payload}.`, `${forged}.${token.split('.')[1]}`, `${token}.extra`, undefined]) {
      expect(adminTokenValid(bad, signingKey, 'pw', 1001), String(bad)).toBe(false);
    }
  });
});

describe('admin routes', () => {
  it('do not exist unless registered', async () => {
    await start({}, false);
    expect((await call('GET', '/v1/admin/status')).statusCode).toBe(404);
    expect((await call('POST', '/v1/admin/login', { payload: { password: PASSWORD } })).statusCode).toBe(404);
  });

  it('answer only from the local network', async () => {
    await start();
    expect((await call('GET', '/v1/admin/status')).json()).toEqual({ enabled: true });
    // Refused requests look like any unknown path.
    const remote = await call('GET', '/v1/admin/status', { from: '65.128.135.123' });
    expect(remote.statusCode).toBe(404);
    const unknown = await call('GET', '/v1/nothing-here', { from: '65.128.135.123' });
    expect(remote.json()).toMatchObject({ error: unknown.json().error, statusCode: 404 });
    // Behind a reverse proxy the socket is the proxy's (local) address; the forwarding headers give it away.
    expect((await call('GET', '/v1/admin/status', { headers: { 'x-forwarded-for': '203.0.113.9' } })).statusCode).toBe(404);
    expect((await call('POST', '/v1/admin/login', { from: '8.8.8.8', payload: { password: PASSWORD } })).statusCode).toBe(404);
  });

  it('can be opened to remote requests on purpose', async () => {
    await start({ allowRemote: true });
    expect((await call('GET', '/v1/admin/status', { from: '65.128.135.123', headers: { 'x-forwarded-for': '203.0.113.9' } })).statusCode).toBe(200);
  });

  it('require the password, then a token', async () => {
    await start();
    expect((await call('GET', '/v1/admin/settings')).statusCode).toBe(401);
    expect((await call('GET', '/v1/admin/settings', { token: 'nonsense' })).statusCode).toBe(401);
    const wrong = await call('POST', '/v1/admin/login', { payload: { password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('admin-wrong-password');
    expect((await call('POST', '/v1/admin/login', { payload: {} })).statusCode).toBe(401);
    expect((await call('GET', '/v1/admin/settings', { token: await login() })).statusCode).toBe(200);
  });

  it('end a session when the token expires', async () => {
    await start();
    const token = await login();
    clock.advance(9 * 3600_000);
    expect((await call('GET', '/v1/admin/settings', { token })).statusCode).toBe(401);
  });

  it('slow down password guessing without counting the operator\'s own logins', async () => {
    await start({ failedLoginsPerMinute: 3 });
    const wrong = () => call('POST', '/v1/admin/login', { payload: { password: 'nope' } }).then((r) => r.statusCode);
    const right = () => call('POST', '/v1/admin/login', { payload: { password: PASSWORD } }).then((r) => r.statusCode);
    for (let i = 0; i < 10; i++) expect(await right()).toBe(200); // good logins never count
    expect([await wrong(), await wrong(), await wrong()]).toEqual([401, 401, 401]);
    expect(await wrong()).toBe(429);
    expect(await right()).toBe(429); // even the right password waits out the window
    clock.advance(61_000);
    expect(await right()).toBe(200);
    expect(await wrong()).toBe(401); // and the count started again
  });

  it('forget wrong passwords after a good login', async () => {
    await start({ failedLoginsPerMinute: 3 });
    const wrong = () => call('POST', '/v1/admin/login', { payload: { password: 'nope' } }).then((r) => r.statusCode);
    await wrong();
    await wrong();
    expect((await call('POST', '/v1/admin/login', { payload: { password: PASSWORD } })).statusCode).toBe(200);
    expect([await wrong(), await wrong(), await wrong()]).toEqual([401, 401, 401]);
  });

  it('describe each setting with its source, and never reveal secrets', async () => {
    await start();
    store.update({ set: { turnUrls: ['turn:t:3478'], turnSecret: 'super-secret-value', giphyApiKey: 'giphy-key-value' } });
    const res = await call('GET', '/v1/admin/settings', { token: await login() });
    expect(res.body).not.toContain('super-secret-value');
    expect(res.body).not.toContain('giphy-key-value');
    const { settings, authConfigured } = res.json();
    expect(authConfigured).toBe(false);
    expect(settings.maxRoomSize).toEqual({ source: 'env', value: 10, default: 10 });
    expect(settings.turnUrls).toEqual({ source: 'saved', value: ['turn:t:3478'], default: [] });
    expect(settings.turnSecret).toEqual({ source: 'saved', isSet: true, defaultIsSet: false });
  });

  it('change what clients and joins see right away, and put the environment back on reset', async () => {
    await start();
    const token = await login();
    expect((await config()).limits.maxRoomSize).toBe(10);
    expect((await config()).announcement).toBeUndefined();

    const changed = await call('PATCH', '/v1/admin/settings', {
      token,
      payload: { set: { maxRoomSize: 4, warnRoomSize: 3, announcement: 'Back in ten minutes', minClientVersion: '1.0.0', turnUrls: ['turn:relay.example.com:3478'], turnSecret: 's3cret', relayVideoKbps: 800 } },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().settings.maxRoomSize.value).toBe(4);

    const c = await config();
    expect(c.limits).toMatchObject({ maxRoomSize: 4, warnRoomSize: 3, relayVideoTier: { maxBitrate: 800_000 } });
    expect(c.announcement?.text).toBe('Back in ten minutes');
    expect(c.minClientVersion).toBe('1.0.0');

    // A join now carries a relay, in the join token's room limit and in the ICE servers; and the version gate applies.
    const refused = await app.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room: 'cozy-room-abc123', clientVersion: '0.9.0' }, headers: { host: 'orvo.example.com' } });
    expect(refused.statusCode).toBe(426);
    const joined = JoinResponse.parse((await app.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room: 'cozy-room-abc123', clientVersion: '1.0.0' }, headers: { host: 'orvo.example.com' } })).json());
    expect(joined.tier).toBe('full');
    expect(joined.iceServers.some((s) => s.urls.includes('turn:relay.example.com:3478') && s.username)).toBe(true);

    await call('PATCH', '/v1/admin/settings', { token, payload: { reset: ['maxRoomSize', 'warnRoomSize', 'announcement', 'minClientVersion', 'turnUrls', 'turnSecret', 'relayVideoKbps'] } });
    const back = await config();
    expect(back.limits.maxRoomSize).toBe(10);
    expect(back.announcement).toBeUndefined();
    expect(JoinResponse.parse((await joinRoom('another-room-abc123')).json()).tier).toBe('free');
  });

  it('refuse bad changes with a reason for each field, and change nothing', async () => {
    await start();
    const token = await login();
    const res = await call('PATCH', '/v1/admin/settings', { token, payload: { set: { maxRoomSize: 1000, roomCreation: 'signed-in' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'bad-settings', errors: { maxRoomSize: expect.any(String) } });
    expect((await config()).limits.maxRoomSize).toBe(10);
    for (const payload of [{ set: 'x' }, { set: [] }, { reset: 'maxRoomSize' }, { reset: [1] }]) {
      expect((await call('PATCH', '/v1/admin/settings', { token, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe('beacon without live settings', () => {
  it('behaves as before', async () => {
    app = await createBeaconApp({ signingKey, store: new MemoryPlacementStore([{ id: 'node-1', region: 'r', weight: 1, draining: false }], () => clock.now), stunUrls: [], limits: { maxRoomSize: 4 }, now: () => clock.now, rateLimitPerMinute: false });
    expect((await config()).limits.maxRoomSize).toBe(4);
  });
});
