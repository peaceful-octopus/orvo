import { contrast } from './contrast';
import type { Mode, Tokens } from './palettes';

export interface AvatarColors {
  /** Gradient start (top left) and end (bottom right). */
  from: string;
  to: string;
  /** The head and shoulders drawn over the gradient. */
  figure: string;
}

/** Hues are spread over this many evenly spaced steps around the palette's own accent hue. */
const HUE_STEPS = 24;
/** The figure must stand out from the gradient's start by at least this much; the end is darker or lighter still. */
const MIN_FIGURE_CONTRAST = 2.5;

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl {
  const [r, g, b] = [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** `amount` of `b` mixed into `a`, both `#rrggbb`. */
function mix(a: string, b: string, amount: number): string {
  const channel = (i: number) => {
    const x = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
    const y = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** A small, stable hash of a string (FNV-1a), so the same name gets the same colour for everyone. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Colours for the picture shown in place of someone's camera. Each person's hue is chosen from their name, spaced
 * around the active palette's accent hue, and its strength and lightness come from that accent too, so the pictures
 * suit the palette. Dark mode fades toward the page background; light mode deepens toward the text colour. The figure
 * is always drawn in a colour that stands out from the gradient.
 */
export function avatarColors(seed: string, tokens: Tokens, mode: Mode): AvatarColors {
  const accent = hexToHsl(tokens.accent);
  const dark = mode === 'dark';
  const figure = dark ? tokens.text : tokens.bg;
  const hue = (accent.h + (hashString(seed) % HUE_STEPS) * (360 / HUE_STEPS)) % 360;
  const s = Math.min(Math.max(accent.s, 0.45), 0.8);

  // Start from the accent's lightness and darken until the figure reads against it.
  let l = Math.min(Math.max(accent.l, 0.4), 0.7);
  let from = hslToHex({ h: hue, s, l });
  while (contrast(figure, from) < MIN_FIGURE_CONTRAST && l > 0.2) {
    l -= 0.02;
    from = hslToHex({ h: hue, s, l });
  }
  const to = dark ? mix(from, tokens.bg, 0.8) : mix(from, tokens.text, 0.4);
  return { from, to, figure };
}
