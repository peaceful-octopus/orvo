import { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore, settingsFromEnv, type Settings } from './settings';
import { redisSettings } from './settings-backend';

const defaults = (): Settings => settingsFromEnv({}, { roomCreation: 'anyone', defaultRoomAccess: 'anyone' });

// Each test gets its own Redis, since the mock shares its data between clients that use the same address.
let counter = 0;
const connect = (host: string) => new RedisMock({ host }) as unknown as Redis;
const open = (redis: Redis, warn?: (m: string) => void) => SettingsStore.open({ defaults: defaults(), backend: redisSettings(redis), authConfigured: false, warn });

const stores: SettingsStore[] = [];
const track = async (promise: Promise<SettingsStore>) => {
  const store = await promise;
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
// Stands in for the second connection a beacon opens to hear about changes.
const quietSubscriber = { on: () => {}, subscribe: async () => {}, quit: async () => {} };
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('settings kept in Redis', () => {
  it('gives a beacon that starts later the settings saved before it came up', async () => {
    const host = `later-${counter++}`;
    const first = await track(open(connect(host)));
    expect(await first.update({ set: { maxRoomSize: 4, announcement: 'Back at 5' } })).toEqual({ ok: true });

    const second = await track(open(connect(host)));
    expect(second.effective()).toMatchObject({ maxRoomSize: 4, announcement: 'Back at 5' });
    expect(second.isSaved('maxRoomSize')).toBe(true);
  });

  it('shows a running beacon a change saved by another one, and a reset', async () => {
    const host = `running-${counter++}`;
    const a = await track(open(connect(host)));
    const b = await track(open(connect(host)));

    await a.update({ set: { maxRoomSize: 5, warnRoomSize: 4 } });
    await settled();
    expect(b.effective()).toMatchObject({ maxRoomSize: 5, warnRoomSize: 4 });

    await a.update({ reset: ['maxRoomSize', 'warnRoomSize'] });
    await settled();
    expect(b.effective().maxRoomSize).toBe(10);
    expect(b.isSaved('maxRoomSize')).toBe(false);
  });

  it('starts from the environment when Redis cannot be read, and says so', async () => {
    const warnings: string[] = [];
    const broken = { hgetall: async () => Promise.reject(new Error('connection refused')), duplicate: () => quietSubscriber } as unknown as Redis;
    const store = await open(broken, (m) => warnings.push(m));
    expect(store.effective()).toEqual(defaults());
    expect(warnings.join(' ')).toContain('connection refused');
  });

  it('changes nothing when Redis cannot be written', async () => {
    const tx = { hset: () => tx, hdel: () => tx, publish: () => tx, exec: async () => Promise.reject(new Error('read only')) };
    const broken = { hgetall: async () => ({}), duplicate: () => quietSubscriber, multi: () => tx } as unknown as Redis;
    const store = await open(broken);
    expect(await store.update({ set: { maxRoomSize: 4 } })).toMatchObject({ ok: false, errors: { _: expect.stringContaining('read only') } });
    expect(store.effective().maxRoomSize).toBe(10);
  });

  describe('changes made at the same time', () => {
    const withoutNotices = (redis: Redis) => ({ ...redisSettings(redis), watch: undefined });
    const stale = (redis: Redis) => SettingsStore.open({ defaults: defaults(), backend: withoutNotices(redis), authConfigured: false });

    it('keeps both when two beacons save different settings together', async () => {
      const host = `together-${counter++}`;
      const a = await track(stale(connect(host)));
      const b = await track(stale(connect(host)));
      const results = await Promise.all([a.update({ set: { maxRoomSize: 4, warnRoomSize: 3 } }), b.update({ set: { announcement: 'Both' } })]);
      expect(results).toEqual([{ ok: true }, { ok: true }]);
      const reader = await track(open(connect(host)));
      expect(reader.effective()).toMatchObject({ maxRoomSize: 4, warnRoomSize: 3, announcement: 'Both' });
    });

    it('does not undo a change this beacon has not heard about yet', async () => {
      const host = `unheard-${counter++}`;
      const a = await track(stale(connect(host)));
      const b = await track(stale(connect(host))); // hears nothing from a, so its own view is out of date
      await a.update({ set: { announcement: 'From a' } });
      expect(b.effective().announcement).toBe('');
      await b.update({ set: { maxRoomSize: 5, warnRoomSize: 4 } });
      expect((await track(open(connect(host)))).effective()).toMatchObject({ announcement: 'From a', maxRoomSize: 5 });
      expect(b.effective().announcement).toBe('From a'); // and it now shows what it saved over
    });

    it('removes only the setting that is reset', async () => {
      const host = `reset-${counter++}`;
      const a = await track(open(connect(host)));
      await a.update({ set: { announcement: 'Stay', maxRoomSize: 5, warnRoomSize: 4 } });
      await a.update({ reset: ['maxRoomSize', 'warnRoomSize'] });
      const reader = await track(open(connect(host)));
      expect(reader.effective()).toMatchObject({ announcement: 'Stay', maxRoomSize: 10 });
      expect(reader.isSaved('announcement')).toBe(true);
      expect(reader.isSaved('maxRoomSize')).toBe(false);
    });
  });
});
