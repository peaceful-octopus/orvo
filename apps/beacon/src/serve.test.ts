import { MemoryPlacementStore } from '@orvo/placement';
import { verifyConfig } from '@orvo/protocol';
import { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBeaconServer, type BeaconServer } from './serve';

const nodes = () => new MemoryPlacementStore([{ id: 'n1', region: 'r', weight: 1, draining: false }]);
const LAN = '192.168.0.20';
const SIGNING_KEY = 'test-1:yXTLkKGuZWI8y_qrB_ViYlCpbF6yln5TrPbmVs-qcNk';

const dirs: string[] = [];
const servers: BeaconServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function start(env: Record<string, string> = {}, extra: { relayForEveryRoom?: boolean; redis?: Redis } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-serve-'));
  dirs.push(dir);
  const server = await createBeaconServer({
    env: { DATA_DIR: dir, SIGNING_KEY, RATE_LIMIT_PER_MINUTE: '0', ...env },
    store: nodes(),
    relayForEveryRoom: extra.relayForEveryRoom ?? false,
    redis: extra.redis,
  });
  servers.push(server);
  return server;
}

const payload = async (server: BeaconServer) => {
  const res = await server.app.inject({ method: 'GET', url: '/v1/config', headers: { host: 'orvo.example.com' } });
  const result = verifyConfig(res.json(), { keys: { [server.signingKey.kid]: server.signingKey.publicKey }, now: Date.now(), graceMs: 0 });
  if (!result.ok) throw new Error(result.reason);
  return result.config;
};

describe('createBeaconServer', () => {
  it('reads the starting settings from the environment and publishes them in the signed config', async () => {
    const server = await start({ MAX_ROOM_SIZE: '5', ANNOUNCEMENT: 'Hello' });
    const config = await payload(server);
    expect(config.limits.maxRoomSize).toBe(5);
    expect(config.announcement?.text).toBe('Hello');
  });

  it('has the admin page only when there is a password, and lets it change what clients see', async () => {
    expect((await (await start()).app.inject({ method: 'GET', url: '/v1/admin/status', remoteAddress: LAN })).statusCode).toBe(404);

    const server = await start({ ADMIN_PASSWORD: 'pw' });
    const login = await server.app.inject({ method: 'POST', url: '/v1/admin/login', payload: { password: 'pw' }, remoteAddress: LAN });
    const { token } = login.json() as { token: string };
    const patch = await server.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      payload: { set: { announcement: 'From the admin page' } },
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: LAN,
    });
    expect(patch.statusCode).toBe(200);
    expect((await payload(server)).announcement?.text).toBe('From the admin page');
  });

  it('keeps saved settings in the data directory, or in Redis when it is given, so a second server sees them', async () => {
    const redis = new RedisMock({ host: 'serve-test' }) as unknown as Redis;
    const first = await start({}, { redis });
    expect(await first.settings.update({ set: { maxRoomSize: 4 } })).toEqual({ ok: true });
    const second = await start({}, { redis });
    expect((await payload(second)).limits.maxRoomSize).toBe(4);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-serve-'));
    dirs.push(dir);
    const alone = await start({ DATA_DIR: dir });
    await alone.settings.update({ set: { maxRoomSize: 6 } });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))).toEqual({ maxRoomSize: 6 });
  });

  it('offers the activities that ship with the server', async () => {
    const bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-bundled-'));
    dirs.push(bundled);
    fs.mkdirSync(path.join(bundled, 'demo'));
    fs.writeFileSync(path.join(bundled, 'demo', 'index.html'), '<p>demo</p>');
    fs.writeFileSync(
      path.join(bundled, 'demo', 'manifest.json'),
      JSON.stringify({ id: 'demo', name: 'Demo', description: 'd', version: '1', apiVersion: 1, minPlayers: 1, maxPlayers: 2, capabilities: [] }),
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-serve-'));
    dirs.push(dir);
    const server = await createBeaconServer({ env: { DATA_DIR: dir, SIGNING_KEY }, store: nodes(), bundledActivities: bundled, relayForEveryRoom: false });
    servers.push(server);
    expect((await payload(server)).activities?.map((a) => a.id)).toEqual(['demo']);
  });

  it('gives a configured relay to every room only when asked to, and otherwise only to entitled ones', async () => {
    const relay = { TURN_URLS: 'turn:t:3478', TURN_SECRET: 'secret' };
    const join = (s: BeaconServer) =>
      s.app.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room: 'room-1', peerId: 'p1' }, headers: { host: 'orvo.example.com' } });
    const urls = async (s: BeaconServer) => JSON.stringify((await join(s)).json());
    expect(await urls(await start(relay, { relayForEveryRoom: true }))).toContain('turn:t:3478');
    expect(await urls(await start(relay, { relayForEveryRoom: false }))).not.toContain('turn:t:3478');
  });

  it('tells the admin page when beacons sharing Redis start from different environment values', async () => {
    const redis = new RedisMock({ host: 'serve-drift' }) as unknown as Redis;
    const env = { ADMIN_PASSWORD: 'pw' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await start({ ...env, MAX_ROOM_SIZE: '6' }, { redis });
      const second = await start({ ...env, MAX_ROOM_SIZE: '4' }, { redis });
      const login = await second.app.inject({ method: 'POST', url: '/v1/admin/login', payload: { password: 'pw' }, remoteAddress: LAN });
      const { token } = login.json() as { token: string };
      const view = await second.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: { authorization: `Bearer ${token}` }, remoteAddress: LAN });
      expect(view.json().drift.settings).toEqual(['maxRoomSize']);
      expect(warn.mock.calls.flat().join(' ')).toContain('different environment values for: maxRoomSize');

      // Saving the setting settles it: the saved value is what every beacon serves.
      await second.settings.update({ set: { maxRoomSize: 5, warnRoomSize: 4 } });
      const after = await second.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: { authorization: `Bearer ${token}` }, remoteAddress: LAN });
      expect(after.json().drift).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('reports nothing without Redis, where there is only one beacon', async () => {
    const server = await start({ ADMIN_PASSWORD: 'pw' });
    const login = await server.app.inject({ method: 'POST', url: '/v1/admin/login', payload: { password: 'pw' }, remoteAddress: LAN });
    const { token } = login.json() as { token: string };
    const view = await server.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: { authorization: `Bearer ${token}` }, remoteAddress: LAN });
    expect(view.json().drift).toBeUndefined();
  });
});
