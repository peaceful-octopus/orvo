import { describe, expect, it } from 'vitest';
import { anyAlive, easeOutBack, particleState, spawnReaction } from './particles';

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

const W = 640;
const H = 480;

describe('easeOutBack', () => {
  it('runs from 0 to 1, overshooting on the way', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...[0.3, 0.5, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
    expect(easeOutBack(-1)).toBeCloseTo(0);
    expect(easeOutBack(5)).toBeCloseTo(1);
  });
});

describe('spawnReaction', () => {
  it('creates the requested number of particles inside the frame width, below its bottom edge', () => {
    const ps = spawnReaction('🎉', W, H, 1000, seeded(1), 20);
    expect(ps).toHaveLength(20);
    for (const p of ps) {
      expect(p.emoji).toBe('🎉');
      expect(p.x0).toBeGreaterThan(0);
      expect(p.x0).toBeLessThan(W);
      expect(p.y0).toBeGreaterThan(H);
      expect(p.size).toBeGreaterThan(H * 0.1);
      expect(p.size).toBeLessThan(H * 0.3);
      expect(p.bornAt).toBeGreaterThanOrEqual(1000);
      expect(p.bornAt).toBeLessThan(1500);
    }
  });

  it('is repeatable with the same random source and varied otherwise', () => {
    const a = spawnReaction('❤️', W, H, 0, seeded(7));
    const b = spawnReaction('❤️', W, H, 0, seeded(7));
    expect(a).toEqual(b);
    expect(new Set(a.map((p) => Math.round(p.x0))).size).toBeGreaterThan(5);
  });
});

describe('particleState', () => {
  const [p] = spawnReaction('👍', W, H, 0, seeded(3), 1);
  const born = p!.bornAt;

  it('is invisible before it is born and after it dies', () => {
    expect(particleState(p!, born - 10)).toMatchObject({ alpha: 0, size: 0, alive: true });
    expect(particleState(p!, born + p!.lifeMs)).toMatchObject({ alive: false });
  });

  it('fades in, holds, and fades out', () => {
    expect(particleState(p!, born + 20).alpha).toBeLessThan(0.5);
    expect(particleState(p!, born + 600).alpha).toBe(1);
    const nearEnd = particleState(p!, born + p!.lifeMs - 100).alpha;
    expect(nearEnd).toBeGreaterThan(0);
    expect(nearEnd).toBeLessThan(0.3);
  });

  it('rises over time and ends higher than it started', () => {
    const early = particleState(p!, born + 300);
    const late = particleState(p!, born + 1500);
    expect(late.y).toBeLessThan(early.y);
    expect(late.y).toBeLessThan(p!.y0 - H * 0.3);
  });

  it('wobbles sideways within its amplitude', () => {
    for (let t = 0; t < p!.lifeMs; t += 100) {
      expect(Math.abs(particleState(p!, born + t).x - p!.x0)).toBeLessThanOrEqual(p!.amplitude + 1e-9);
    }
  });
});

describe('anyAlive', () => {
  it('is true until every particle has finished', () => {
    const ps = spawnReaction('😂', W, H, 0, seeded(9), 10);
    expect(anyAlive(ps, 0)).toBe(true);
    expect(anyAlive(ps, 1500)).toBe(true);
    expect(anyAlive(ps, 5000)).toBe(false);
    expect(anyAlive([], 0)).toBe(false);
  });
});
