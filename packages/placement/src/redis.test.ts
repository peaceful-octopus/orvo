import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisPlacementStore } from './redis';
import { describeStoreContract } from './store.contract';

// The mock expires keys on the real clock, so the contract's time travel uses fake timers.
let counter = 0;
// Each mock registers a listener on a shared emitter until it is disconnected, so they are closed after every test.
const opened: InstanceType<typeof RedisMock>[] = [];
const mock = () => {
  const redis = new RedisMock();
  opened.push(redis);
  return redis;
};
describeStoreContract('Redis (ioredis-mock)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const redis = mock();
  await redis.flushall();
  return {
    store: new RedisPlacementStore(redis as never, `t${counter++}:`),
    advance: async (ms) => void vi.advanceTimersByTime(ms),
  };
});

afterEach(() => {
  vi.useRealTimers();
  for (const redis of opened.splice(0)) redis.disconnect();
});

describe('RedisPlacementStore', () => {
  it('prunes expired nodes from its index when listing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const redis = mock();
    await redis.flushall();
    const store = new RedisPlacementStore(redis as never, 'prune:');
    await store.registerNode({ id: 'a', region: 'r', weight: 1, draining: false }, 1_000);
    vi.advanceTimersByTime(2_000);
    expect(await store.listNodes()).toEqual([]);
    expect(await redis.smembers('prune:nodes')).toEqual([]);
  });
});
