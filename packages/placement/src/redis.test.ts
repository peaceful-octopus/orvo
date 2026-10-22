import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisPlacementStore } from './redis';
import { describeStoreContract } from './store.contract';

// The mock expires keys on the real clock, so the contract's time travel uses fake timers.
let counter = 0;
describeStoreContract('Redis (ioredis-mock)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const redis = new RedisMock();
  await redis.flushall();
  return {
    store: new RedisPlacementStore(redis as never, `t${counter++}:`),
    advance: async (ms) => void vi.advanceTimersByTime(ms),
  };
});

afterEach(() => vi.useRealTimers());

describe('RedisPlacementStore', () => {
  it('prunes expired nodes from its index when listing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const redis = new RedisMock();
    await redis.flushall();
    const store = new RedisPlacementStore(redis as never, 'prune:');
    await store.registerNode({ id: 'a', region: 'r', weight: 1, draining: false }, 1_000);
    vi.advanceTimersByTime(2_000);
    expect(await store.listNodes()).toEqual([]);
    expect(await redis.smembers('prune:nodes')).toEqual([]);
  });
});
