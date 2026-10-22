import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';
import { DEFAULT_PALETTE, PALETTES, type Tokens } from './palettes';

const ROLES = Object.keys(PALETTES[DEFAULT_PALETTE]!.dark) as (keyof Tokens)[];

describe('contrast', () => {
  it('matches known values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});

describe.each(Object.entries(PALETTES))('palette %s', (_key, palette) => {
  describe.each([
    ['dark', palette.dark],
    ['light', palette.light],
  ] as const)('%s', (_mode, t) => {
    it('defines every role', () => {
      expect(Object.keys(t).sort()).toEqual([...ROLES].sort());
    });

    it('keeps body text readable (4.5:1) on every surface', () => {
      for (const background of [t.bg, t.surface, t.raised, t.hover]) {
        expect(contrast(t.text, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.muted, background)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps text on the accent and danger fills readable, including under the pointer', () => {
      expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onAccent, t.accentHover)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onDanger, t.danger)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onDanger, t.dangerHover)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the parts you operate visible (3:1)', () => {
      expect(contrast(t.borderStrong, t.surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.focus, t.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.live, t.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.accent, t.track)).toBeGreaterThanOrEqual(3);
    });
  });
});
