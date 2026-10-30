import { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { DriftMonitor, fingerprints, findDrift, redisRegistry, type BeaconRegistry, type DriftEntry } from './drift';
import { settingsFromEnv, type Settings } from './settings';

const rules = { roomCreation: 'anyone', defaultRoomAccess: 'anyone' } as const;
const defaults = (env: Record<string, string> = {}): Settings => settingsFromEnv(env, rules);
const SECRET = new Uint8Array(32).fill(7);
const entry = (env: Record<string, string>, seen = 1000): DriftEntry => ({ seen, settings: fingerprints(defaults(env), SECRET) });
const notSaved = () => false;

describe('fingerprints', () => {
  it('are the same for the same values, differ when a value differs, and do not contain the secret', () => {
    expect(entry({ ANNOUNCEMENT: 'a' }).settings).toEqual(entry({ ANNOUNCEMENT: 'a' }).settings);
    expect(entry({ ANNOUNCEMENT: 'a' }).settings.announcement).not.toBe(entry({ ANNOUNCEMENT: 'b' }).settings.announcement);
    expect(entry({ ANNOUNCEMENT: 'a' }).settings.maxRoomSize).toBe(entry({ ANNOUNCEMENT: 'b' }).settings.maxRoomSize);
    expect(JSON.stringify(entry({ TURN_SECRET: 'hunter2-secret', TURN_URLS: 'turn:t:1' }))).not.toContain('hunter2');
  });

  it('depend on the key, so a secret cannot be guessed from the hash without it', () => {
    expect(fingerprints(defaults(), SECRET).turnSecret).not.toBe(fingerprints(defaults(), new Uint8Array(32).fill(8)).turnSecret);
  });
});

describe('findDrift', () => {
  it('finds nothing when the beacons agree, or when there is only one', () => {
    expect(findDrift({ a: entry({}), b: entry({}) }, 1000, 60_000, notSaved)).toBeUndefined();
    expect(findDrift({ a: entry({ MAX_ROOM_SIZE: '4' }) }, 1000, 60_000, notSaved)).toBeUndefined();
  });

  it('names the settings that differ and the beacon that differs from the rest', () => {
    const drift = findDrift({ a: entry({ MAX_ROOM_SIZE: '6' }), b: entry({ MAX_ROOM_SIZE: '6' }), c: entry({ MAX_ROOM_SIZE: '4', ANNOUNCEMENT: 'x' }) }, 1000, 60_000, notSaved);
    expect(drift?.settings).toEqual(['maxRoomSize', 'announcement']);
    expect(drift?.differing).toEqual({ c: ['maxRoomSize', 'announcement'] });
  });

  it('leaves out settings that have a saved value, since that value overrides every environment', () => {
    const entries = { a: entry({ ANNOUNCEMENT: 'x' }), b: entry({ ANNOUNCEMENT: 'y', MAX_ROOM_SIZE: '4' }) };
    expect(findDrift(entries, 1000, 60_000, (key) => key === 'announcement')?.settings).toEqual(['maxRoomSize']);
    expect(findDrift(entries, 1000, 60_000, (key) => key === 'announcement' || key === 'maxRoomSize')).toBeUndefined();
  });

  it('ignores beacons that have not reported for a while', () => {
    const entries = { a: entry({}, 100_000), b: entry({ MAX_ROOM_SIZE: '4' }, 1000) };
    expect(findDrift(entries, 100_000, 60_000, notSaved)).toBeUndefined();
  });

  it('names the same beacon on every beacon when the split is even', () => {
    const entries = { a: entry({ MAX_ROOM_SIZE: '6' }), b: entry({ MAX_ROOM_SIZE: '4' }) };
    expect(findDrift(entries, 1000, 60_000, notSaved)).toEqual(findDrift({ b: entries.b, a: entries.a }, 1000, 60_000, notSaved));
  });
});

function memoryRegistry(): BeaconRegistry & { entries_: Record<string, DriftEntry> } {
  const entries_: Record<string, DriftEntry> = {};
  return {
    entries_,
    async announce(id, e) {
      entries_[id] = e;
    },
    async entries() {
      return { ...entries_ };
    },
    async remove(id) {
      delete entries_[id];
    },
  };
}

describe('DriftMonitor', () => {
  const monitor = (registry: BeaconRegistry, id: string, env: Record<string, string>, warnings: string[], saved: string[] = []) => {
    let now = 1000;
    const m = new DriftMonitor({ registry, id, defaults: defaults(env), secret: SECRET, isSaved: (k) => saved.includes(k), now: () => now, intervalMs: 10_000, warn: (w) => warnings.push(w) });
    return { m, advance: (ms: number) => (now += ms) };
  };

  it('warns once when another beacon starts from a different environment, and again when they agree', async () => {
    const registry = memoryRegistry();
    const warnings: string[] = [];
    const a = monitor(registry, 'beacon-a', { MAX_ROOM_SIZE: '6' }, warnings);
    await a.m.check();
    expect(warnings).toEqual([]);

    const other: string[] = [];
    const b = monitor(registry, 'beacon-b', { MAX_ROOM_SIZE: '4' }, other);
    await b.m.check();
    expect(other).toHaveLength(1);
    expect(other[0]).toContain('maxRoomSize');
    expect(b.m.current()?.settings).toEqual(['maxRoomSize']);

    await b.m.check();
    expect(other).toHaveLength(1); // the same difference is not reported again

    await a.m.check();
    expect(warnings).toHaveLength(1);

    // Beacon b is restarted with the same environment as a.
    const fixed = monitor(registry, 'beacon-b', { MAX_ROOM_SIZE: '6' }, other);
    await fixed.m.check();
    expect(fixed.m.current()).toBeUndefined();
    await a.m.check();
    expect(a.m.current()).toBeUndefined();
    expect(warnings.at(-1)).toContain('same environment values again');
  });

  it('stops warning once the differing setting is saved in the admin page', async () => {
    const registry = memoryRegistry();
    const warnings: string[] = [];
    const saved: string[] = [];
    const a = monitor(registry, 'a', { ANNOUNCEMENT: 'x' }, warnings, saved);
    const b = monitor(registry, 'b', { ANNOUNCEMENT: 'y' }, [], saved);
    await a.m.check();
    await b.m.check();
    await a.m.check();
    expect(a.m.current()?.settings).toEqual(['announcement']);
    saved.push('announcement');
    await a.m.check();
    expect(a.m.current()).toBeUndefined();
  });

  it('removes its entry when it stops, and keeps what it knew when Redis cannot be reached', async () => {
    const registry = memoryRegistry();
    const a = monitor(registry, 'a', {}, []);
    await a.m.check();
    expect(Object.keys(registry.entries_)).toEqual(['a']);
    await a.m.stop();
    expect(registry.entries_).toEqual({});

    const down: BeaconRegistry = { announce: async () => Promise.reject(new Error('down')), entries: async () => Promise.reject(new Error('down')), remove: async () => Promise.reject(new Error('down')) };
    const b = monitor(down, 'b', {}, []);
    await expect(b.m.check()).resolves.toBeUndefined();
    await expect(b.m.stop()).resolves.toBeUndefined();
  });
});

describe('redisRegistry', () => {
  it('shares entries between beacons on the same Redis and ignores a damaged one', async () => {
    const redis = new RedisMock({ host: 'drift-registry' }) as unknown as Redis;
    const registry = redisRegistry(redis);
    await registry.announce('a', entry({}));
    await redis.hset('orvo:beacons', 'broken', 'not json');
    expect(Object.keys(await registry.entries())).toEqual(['a']);
    await registry.remove('a');
    expect(await registry.entries()).toEqual({});
  });
});
