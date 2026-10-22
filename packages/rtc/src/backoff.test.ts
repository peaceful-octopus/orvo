import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('grows exponentially up to the cap', () => {
    const max = (attempt: number) => backoffDelay(attempt, () => 1);
    expect([0, 1, 2, 3].map(max)).toEqual([500, 1000, 2000, 4000]);
    expect(max(10)).toBe(30_000);
    expect(max(50)).toBe(30_000);
  });

  it('applies full jitter between zero and the ceiling', () => {
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 0.5)).toBe(2000);
  });
});
