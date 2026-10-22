import { describe, expect, it } from 'vitest';
import { containRect, coverRect, fillAlpha, stickerPlacement } from './layout';

describe('coverRect and containRect', () => {
  it('cover fills the target and crops the excess, centered', () => {
    const r = coverRect(400, 200, 100, 100); // wide source into a square
    expect(r.h).toBe(100);
    expect(r.w).toBe(200);
    expect(r.x).toBe(-50);
    expect(r.y).toBe(0);
  });

  it('contain fits inside the target with bars, centered', () => {
    const r = containRect(400, 200, 100, 100);
    expect(r.w).toBe(100);
    expect(r.h).toBe(50);
    expect(r.x).toBe(0);
    expect(r.y).toBe(25);
  });

  it('keep the source aspect ratio', () => {
    for (const fn of [coverRect, containRect]) {
      const r = fn(320, 180, 640, 480);
      expect(r.w / r.h).toBeCloseTo(320 / 180);
    }
  });
});

describe('stickerPlacement', () => {
  const place = (age: number) => stickerPlacement(250, 192, 640, 480, age, 6000);

  it('pops in from nothing, settles at its full size and shrinks away at the end', () => {
    expect(place(0).w).toBeCloseTo(0);
    const mid = place(3000);
    expect(mid.alpha).toBe(1);
    expect(mid.w).toBeGreaterThan(0);
    expect(place(5900).w).toBeLessThan(mid.w);
    expect(place(6000).w).toBeCloseTo(0);
  });

  it('stays inside the frame and within its share of it', () => {
    for (let age = 0; age <= 6000; age += 100) {
      const p = place(age);
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.x + p.w).toBeLessThanOrEqual(641);
      expect(p.y + p.h).toBeLessThanOrEqual(481);
    }
    const full = place(3000);
    expect(full.w).toBeLessThanOrEqual(640 * 0.62 + 1e-6);
    expect(full.h).toBeLessThanOrEqual(480 * 0.62 + 1e-6);
  });

  it('is centered horizontally and keeps the GIF shape', () => {
    const p = place(3000);
    expect(p.x + p.w / 2).toBeCloseTo(320);
    expect(p.w / p.h).toBeCloseTo(250 / 192);
  });
});

describe('fillAlpha', () => {
  it('fades in and out at the ends and is opaque between', () => {
    expect(fillAlpha(0, 5000)).toBe(0);
    expect(fillAlpha(100, 5000)).toBeCloseTo(0.5);
    expect(fillAlpha(2000, 5000)).toBe(1);
    expect(fillAlpha(4900, 5000)).toBeCloseTo(0.5);
    expect(fillAlpha(5000, 5000)).toBe(0);
  });
});
