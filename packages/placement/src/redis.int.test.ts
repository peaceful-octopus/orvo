import { Redis } from 'ioredis';
import { afterAll, describe, it } from 'vitest';
import { RedisPlacementStore } from './redis';
import { describeStoreContract } from './store.contract';

// Runs the same contract against a real Redis. Skipped unless REDIS_URL is set:
//   REDIS_URL=redis://localhost:6379 pnpm test:integration
const url = process.env.REDIS_URL;

if (!url) {
  describe('Redis (real server)', () => it.skip('set REDIS_URL to run against a real Redis', () => {}));
} else {
  const redis = new Redis(url);
  afterAll(() => redis.quit());
  let counter = 0;
  describeStoreContract('Redis (real server)', async () => {
    const prefix = `int-${Date.now()}-${counter++}:`;
    return {
      store: new RedisPlacementStore(redis, prefix),
      // Real Redis expires on its own clock, so wait it out; contract TTLs are a few seconds at most.
      advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
  });
}
