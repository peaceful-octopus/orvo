export type LayoutMode = 'row' | 'column' | 'campfire';

export const LAYOUT_MODES: LayoutMode[] = ['row', 'column', 'campfire'];

export interface Bounds {
  w: number;
  h: number;
}

export interface Placement {
  /** Bubble diameter. */
  size: number;
  /** Top-left corner of each bubble's square, in order. */
  positions: { x: number; y: number }[];
}

export const MAX_BUBBLE = 240;
/** Gap between bubbles as a fraction of the bubble diameter. */
const GAP = 0.12;

export function layout(mode: LayoutMode, count: number, { w, h }: Bounds): Placement {
  if (count <= 0 || w <= 0 || h <= 0) return { size: 0, positions: [] };

  if (mode === 'campfire' && count > 1) return campfire(count, w, h);

  // A single bubble is centered whatever the mode.
  const along = mode === 'column' ? h : w;
  const across = mode === 'column' ? w : h;
  const size = Math.min(MAX_BUBBLE, across, along / (count + GAP * (count - 1)));
  const gap = size * GAP;
  const total = count * size + (count - 1) * gap;
  const start = (along - total) / 2;
  const offset = (across - size) / 2;

  return {
    size,
    positions: Array.from({ length: count }, (_, i) => {
      const a = start + i * (size + gap);
      return mode === 'column' ? { x: offset, y: a } : { x: a, y: offset };
    }),
  };
}

function campfire(count: number, w: number, h: number): Placement {
  const m = Math.min(w, h);
  const s = Math.sin(Math.PI / count);
  // Neighbouring bubble centers are 2R*sin(pi/n) apart and the ring must fit inside m.
  const size = Math.min(MAX_BUBBLE, (m * s) / (1 + GAP + s));
  const radius = (size * (1 + GAP)) / (2 * s);
  const cx = w / 2;
  const cy = h / 2;

  return {
    size,
    positions: Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
      return { x: cx + radius * Math.cos(angle) - size / 2, y: cy + radius * Math.sin(angle) - size / 2 };
    }),
  };
}

const FLOAT_BUBBLE = 96;
const FLOAT_PAD = 16;

/** Window size that fits `count` bubbles at a compact fixed diameter, for the floating window. */
export function floatWindowSize(mode: LayoutMode, count: number): Bounds {
  const n = Math.max(count, 1);
  const gap = FLOAT_BUBBLE * GAP;
  const line = n * FLOAT_BUBBLE + (n - 1) * gap + FLOAT_PAD * 2;
  const thin = FLOAT_BUBBLE + FLOAT_PAD * 2;

  if (mode === 'row') return { w: line, h: thin };
  if (mode === 'column') return { w: thin, h: line };
  if (n === 1) return { w: thin, h: thin };
  const s = Math.sin(Math.PI / n);
  const side = (FLOAT_BUBBLE * (1 + GAP + s)) / s + FLOAT_PAD * 2;
  return { w: side, h: side };
}
