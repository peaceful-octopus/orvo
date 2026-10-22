import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_SIZES, planRooms, sampleSessionSeconds, sampleSize, seededRandom } from './scenario';

describe('seededRandom', () => {
  it('repeats exactly for a seed and differs between seeds', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const first = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(first);
    expect(Array.from({ length: 5 }, seededRandom(8))).not.toEqual(first);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('planRooms', () => {
  it('uses every user exactly once, within the room-size cap', () => {
    for (const users of [1, 2, 9, 100, 10_000]) {
      const rooms = planRooms(users, DEFAULT_ROOM_SIZES, seededRandom(users));
      expect(rooms.reduce((a, b) => a + b, 0)).toBe(users);
      expect(Math.max(...rooms)).toBeLessThanOrEqual(10);
      expect(Math.min(...rooms)).toBeGreaterThanOrEqual(1);
    }
  });

  it('follows the weights', () => {
    const sizes = Array.from({ length: 20_000 }, ((r) => () => sampleSize(DEFAULT_ROOM_SIZES, r))(seededRandom(3)));
    const share = (n: number) => sizes.filter((s) => s === n).length / sizes.length;
    expect(share(2)).toBeGreaterThan(0.36);
    expect(share(2)).toBeLessThan(0.44);
    expect(share(10)).toBeLessThan(0.02);
    expect(share(2)).toBeGreaterThan(share(5));
  });

  it('gives the average room about three people, as casual calls tend to', () => {
    const rooms = planRooms(50_000, DEFAULT_ROOM_SIZES, seededRandom(5));
    const mean = 50_000 / rooms.length;
    expect(mean).toBeGreaterThan(2.8);
    expect(mean).toBeLessThan(3.6);
  });
});

describe('sampleSessionSeconds', () => {
  it('has roughly the requested mean and respects the minimum', () => {
    const random = seededRandom(11);
    const values = Array.from({ length: 20_000 }, () => sampleSessionSeconds(300, random));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(290);
    expect(mean).toBeLessThan(320);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(10);
  });
});
