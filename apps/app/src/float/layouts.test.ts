import { describe, expect, it } from 'vitest';
import { LAYOUT_MODES, MAX_BUBBLE, UNCAPPED, bubbleForWindow, floatWindowSize, layout, splitForScreens } from './layouts';

const bounds = { w: 800, h: 500 };
const EPS = 1e-6;

describe('layout', () => {
  for (const mode of LAYOUT_MODES) {
    describe(mode, () => {
      for (let count = 1; count <= 10; count++) {
        it(`fits ${count} bubbles inside bounds without overlap`, () => {
          const { size, positions } = layout(mode, count, bounds);
          expect(positions).toHaveLength(count);
          for (const p of positions) {
            expect(p.x).toBeGreaterThanOrEqual(-EPS);
            expect(p.y).toBeGreaterThanOrEqual(-EPS);
            expect(p.x + size).toBeLessThanOrEqual(bounds.w + EPS);
            expect(p.y + size).toBeLessThanOrEqual(bounds.h + EPS);
          }
          for (let i = 0; i < count; i++) {
            for (let j = i + 1; j < count; j++) {
              const d = Math.hypot(positions[i]!.x - positions[j]!.x, positions[i]!.y - positions[j]!.y);
              expect(d).toBeGreaterThanOrEqual(size - EPS);
            }
          }
        });
      }
    });
  }

  it('places campfire bubbles at equal angles around the center', () => {
    const { size, positions } = layout('campfire', 6, bounds);
    const center = { x: bounds.w / 2, y: bounds.h / 2 };
    const angles = positions.map((p) => Math.atan2(p.y + size / 2 - center.y, p.x + size / 2 - center.x));
    for (let i = 1; i < angles.length; i++) {
      const step = (angles[i]! - angles[i - 1]! + 2 * Math.PI) % (2 * Math.PI);
      expect(step).toBeCloseTo((2 * Math.PI) / 6, 6);
    }
  });

  it('centers a single bubble in every mode', () => {
    for (const mode of LAYOUT_MODES) {
      const { size, positions } = layout(mode, 1, bounds);
      expect(positions[0]!.x + size / 2).toBeCloseTo(bounds.w / 2);
      expect(positions[0]!.y + size / 2).toBeCloseTo(bounds.h / 2);
    }
  });

  it('returns nothing for empty or zero-size input', () => {
    expect(layout('row', 0, bounds).positions).toEqual([]);
    expect(layout('row', 3, { w: 0, h: 0 }).positions).toEqual([]);
  });
});

describe('bubble size cap', () => {
  const big = { w: 2000, h: 1400 };

  it('caps bubbles by default', () => {
    for (const mode of LAYOUT_MODES) expect(layout(mode, 3, big).size).toBeLessThanOrEqual(MAX_BUBBLE);
  });

  it('lets bubbles keep growing with the window when uncapped', () => {
    for (const mode of LAYOUT_MODES) {
      const small = layout(mode, 3, { w: 900, h: 700 }, UNCAPPED).size;
      const large = layout(mode, 3, big, UNCAPPED).size;
      expect(large).toBeGreaterThan(MAX_BUBBLE);
      expect(large).toBeGreaterThan(small);
    }
  });
});

describe('floatWindowSize', () => {
  it('is wide for row, tall for column, square for campfire', () => {
    const row = floatWindowSize('row', 4);
    const column = floatWindowSize('column', 4);
    const fire = floatWindowSize('campfire', 4);
    expect(row.w).toBeGreaterThan(row.h);
    expect(column.h).toBeGreaterThan(column.w);
    expect(fire.w).toBe(fire.h);
  });

  it('gives a layout the room to draw bubbles at the compact size', () => {
    for (const mode of LAYOUT_MODES) {
      for (let n = 1; n <= 10; n++) {
        const { size } = layout(mode, n, floatWindowSize(mode, n));
        expect(size).toBeGreaterThanOrEqual(128 - EPS);
      }
    }
  });
});

describe('remembered float size', () => {
  it('a window fitted for a bubble size reports that size back, for any count and mode', () => {
    for (const mode of LAYOUT_MODES) {
      for (let n = 1; n <= 10; n++) {
        for (const bubble of [64, 128, 300]) {
          expect(Math.abs(bubbleForWindow(mode, n, floatWindowSize(mode, n, bubble)) - bubble)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('keeps the bubble size when people join, instead of the window size', () => {
    const bubble = bubbleForWindow('row', 2, { w: 900, h: 400 });
    expect(floatWindowSize('row', 4, bubble).w).toBeGreaterThan(floatWindowSize('row', 2, bubble).w);
  });

  it('clamps absurd sizes', () => {
    expect(bubbleForWindow('row', 1, { w: 10, h: 10 })).toBe(48);
    expect(bubbleForWindow('row', 1, { w: 9000, h: 9000 })).toBe(800);
  });
});

describe('splitForScreens', () => {
  it('gives the whole window to the bubbles when nothing is shared', () => {
    const s = splitForScreens({ w: 800, h: 500 }, 0);
    expect(s.screens).toEqual([]);
    expect(s.bubbles).toEqual({ x: 0, y: 0, w: 800, h: 500 });
  });

  it('puts the screen left and the bubbles in a column on the right in a wide window', () => {
    const s = splitForScreens({ w: 1000, h: 500 }, 1);
    expect(s.direction).toBe('column');
    expect(s.screens[0]!.x).toBe(0);
    expect(s.screens[0]!.w).toBeGreaterThan(s.bubbles.w);
    expect(s.bubbles.x).toBeCloseTo(s.screens[0]!.w);
  });

  it('puts the screen on top and the bubbles in a row below in a tall window', () => {
    const s = splitForScreens({ w: 500, h: 1000 }, 1);
    expect(s.direction).toBe('row');
    expect(s.screens[0]!.h).toBeGreaterThan(s.bubbles.h);
    expect(s.bubbles.y).toBeCloseTo(s.screens[0]!.h);
  });

  it('divides the screen area equally between several screens without overlap', () => {
    const s = splitForScreens({ w: 1000, h: 500 }, 3);
    expect(s.screens).toHaveLength(3);
    const total = s.screens.reduce((a, r) => a + r.w * r.h, 0);
    expect(total).toBeCloseTo(1000 * 0.74 * 500);
    for (let i = 1; i < 3; i++) expect(s.screens[i]!.x + s.screens[i]!.y).toBeGreaterThanOrEqual(s.screens[i - 1]!.x + s.screens[i - 1]!.y);
  });
});
