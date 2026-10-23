import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, fullFrame, stepCrop, targetCrop } from './framing';

const W = 1280;
const H = 720;

describe('targetCrop', () => {
  it('shows the whole picture when there is no face', () => {
    expect(targetCrop(undefined, W, H)).toEqual(fullFrame(W, H));
  });

  it('keeps the picture proportions and stays inside the picture', () => {
    for (const face of [
      { x: 600, y: 300, w: 120, h: 150 },
      { x: 0, y: 0, w: 100, h: 120 },
      { x: 1180, y: 600, w: 100, h: 120 },
    ]) {
      const c = targetCrop(face, W, H);
      expect(c.w / c.h).toBeCloseTo(W / H, 5);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(W + 1e-6);
      expect(c.y + c.h).toBeLessThanOrEqual(H + 1e-6);
    }
  });

  it('zooms in on a small face and leaves a large one alone', () => {
    expect(targetCrop({ x: 600, y: 300, w: 80, h: 100 }, W, H).h).toBeLessThan(H);
    expect(targetCrop({ x: 300, y: 50, w: 500, h: 600 }, W, H)).toEqual(fullFrame(W, H));
  });

  it('never zooms past the limit, however small the face', () => {
    expect(targetCrop({ x: 600, y: 300, w: 10, h: 12 }, W, H).h).toBeCloseTo(H / MAX_ZOOM, 5);
  });

  it('centres the face horizontally when there is room', () => {
    const c = targetCrop({ x: 600, y: 250, w: 100, h: 120 }, W, H);
    expect(c.x + c.w / 2).toBeCloseTo(650, 5);
  });
});

describe('stepCrop', () => {
  const start = fullFrame(W, H);
  const goal = targetCrop({ x: 700, y: 300, w: 90, h: 110 }, W, H);

  it('moves toward the target without jumping to it', () => {
    const next = stepCrop(start, goal, 33);
    expect(next.w).toBeLessThan(start.w);
    expect(next.w).toBeGreaterThan(goal.w);
  });

  it('gets close to the target after enough time, stopping inside the dead band', () => {
    let c = start;
    for (let i = 0; i < 400; i++) c = stepCrop(c, goal, 33);
    expect(Math.abs(c.w - goal.w)).toBeLessThan(goal.w * 0.05);
    expect(Math.abs(c.x - goal.x)).toBeLessThan(goal.w * 0.05);
  });

  it('holds still for small movements', () => {
    const nudged = { ...goal, x: goal.x + goal.w * 0.02 };
    expect(stepCrop(goal, nudged, 33)).toBe(goal);
  });
});
