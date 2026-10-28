import { describe, expect, it } from 'vitest';
import { avatarColors, hashString } from './avatar';
import { contrast } from './contrast';
import { PALETTES } from './palettes';

const NAMES = ['Joel', 'Maya', 'Sam', 'Guest', 'Alex', 'Priya', 'Chen', 'Fatima', 'Omar', 'Zoë', 'A', ''];

describe('avatarColors', () => {
  it('gives the same name the same colours every time', () => {
    const t = PALETTES.evening!.dark;
    expect(avatarColors('Maya', t, 'dark')).toEqual(avatarColors('Maya', t, 'dark'));
    expect(hashString('Maya')).toBe(hashString('Maya'));
  });

  it('gives different people different colours', () => {
    const t = PALETTES.evening!.dark;
    const froms = new Set(NAMES.map((n) => avatarColors(n, t, 'dark').from));
    expect(froms.size).toBeGreaterThan(6);
  });

  it('changes with the light or dark mode', () => {
    const { evening } = PALETTES;
    expect(avatarColors('Maya', evening!.dark, 'dark')).not.toEqual(avatarColors('Maya', evening!.light, 'light'));
  });

  it('changes with the palette', () => {
    expect(avatarColors('Maya', PALETTES.evening!.dark, 'dark').from).not.toBe(avatarColors('Maya', PALETTES.midnight!.dark, 'dark').from);
  });

  describe.each(Object.entries(PALETTES))('palette %s', (_key, palette) => {
    describe.each([
      ['dark', palette.dark],
      ['light', palette.light],
    ] as const)('%s', (mode, tokens) => {
      it('keeps the figure visible on the gradient for every name', () => {
        // Every one of the evenly spaced hues is reached, not just the names above.
        const names = [...NAMES, ...Array.from({ length: 60 }, (_, i) => `person ${i}`)];
        for (const name of names) {
          const c = avatarColors(name, tokens, mode);
          expect(c.from).toMatch(/^#[0-9a-f]{6}$/);
          expect(c.to).toMatch(/^#[0-9a-f]{6}$/);
          expect(contrast(c.figure, c.from), `${name} start`).toBeGreaterThanOrEqual(2.5);
          expect(contrast(c.figure, c.to), `${name} end`).toBeGreaterThanOrEqual(2.5);
        }
      });
    });
  });
});
