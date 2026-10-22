/**
 * Mood filters: a look applied to your camera before it is sent, so everyone sees it. Each filter is plain data: a
 * CSS filter string (colour grading), an optional gradient laid over the picture, and an optional vignette. Adding a
 * filter means adding an entry to `MOOD_FILTERS`.
 */

export interface Tint {
  /** Gradient colour stops, from 0 to 1. */
  stops: [number, string][];
  /** Direction of the gradient in degrees; 180 runs from the top of the picture to the bottom. */
  angle: number;
  /** How the gradient mixes with the picture. */
  blend: GlobalCompositeOperation;
  alpha: number;
}

export interface MoodFilter {
  id: string;
  label: string;
  /** Colour grading, as in the CSS `filter` property. */
  css?: string;
  tint?: Tint;
  /** 0 to 1: how dark the corners get. */
  vignette?: number;
  /** Two colours that suggest the look, for the picker. */
  swatch: [string, string];
}

export const NO_FILTER = 'none';

export const MOOD_FILTERS: MoodFilter[] = [
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.2) brightness(0.95)', vignette: 0.45, swatch: ['#111111', '#c4c4c4'] },
  { id: 'sepia', label: 'Sepia', css: 'sepia(0.85) contrast(1.05) saturate(1.1)', vignette: 0.25, swatch: ['#3b2a1a', '#d8b98a'] },
  {
    id: 'sunset',
    label: 'Sunset',
    css: 'saturate(1.15) contrast(1.05)',
    tint: { stops: [[0, '#ff7a3d'], [1, '#c2185b']], angle: 180, blend: 'soft-light', alpha: 0.9 },
    swatch: ['#ff7a3d', '#c2185b'],
  },
  {
    id: 'ocean',
    label: 'Ocean',
    css: 'saturate(1.05)',
    tint: { stops: [[0, '#35e0c4'], [1, '#1b4fd8']], angle: 160, blend: 'soft-light', alpha: 0.85 },
    swatch: ['#35e0c4', '#1b4fd8'],
  },
  {
    id: 'neon',
    label: 'Neon',
    css: 'saturate(1.5) contrast(1.15)',
    tint: { stops: [[0, '#ff2fd0'], [1, '#22e6ff']], angle: 135, blend: 'overlay', alpha: 0.55 },
    swatch: ['#ff2fd0', '#22e6ff'],
  },
  {
    id: 'dream',
    label: 'Dream',
    css: 'brightness(1.08) saturate(1.2) contrast(0.92) blur(0.8px)',
    tint: { stops: [[0, '#ffb3e6'], [1, '#b3d9ff']], angle: 90, blend: 'screen', alpha: 0.22 },
    swatch: ['#ffb3e6', '#b3d9ff'],
  },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.1)', swatch: ['#ff4d4d', '#37d67a'] },
  {
    id: 'film',
    label: 'Film',
    css: 'contrast(0.88) saturate(0.75) sepia(0.2) brightness(1.05)',
    tint: { stops: [[0, '#ffcf99'], [1, '#ffcf99']], angle: 180, blend: 'multiply', alpha: 0.12 },
    vignette: 0.3,
    swatch: ['#8a7a66', '#e6d5b8'],
  },
];

export function findFilter(id: string | undefined): MoodFilter | undefined {
  return MOOD_FILTERS.find((f) => f.id === id);
}

/** Start and end points of a gradient of `angle` degrees running through the middle of a w x h picture. */
export function gradientLine(angle: number, w: number, h: number) {
  const radians = (angle * Math.PI) / 180;
  // CSS convention: 0 degrees points up, 90 points right, 180 points down.
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2; // reaches the corners, so the gradient spans the picture
  const cx = w / 2;
  const cy = h / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

/** The parts of a canvas context that filters use, so tests can substitute a recorder. */
export type FilterContext = Pick<
  CanvasRenderingContext2D,
  'save' | 'restore' | 'fillRect' | 'createLinearGradient' | 'createRadialGradient' | 'globalAlpha' | 'globalCompositeOperation' | 'fillStyle'
> & { filter?: string };

/** Runs `drawCamera` with the filter's colour grading, then lays the gradient and vignette over the result. */
export function drawFiltered(ctx: FilterContext, filter: MoodFilter | undefined, w: number, h: number, drawCamera: () => void) {
  if (!filter) return drawCamera();

  if (filter.css && 'filter' in ctx) {
    ctx.filter = filter.css;
    drawCamera();
    ctx.filter = 'none';
  } else {
    drawCamera();
  }

  if (filter.tint) {
    const { x0, y0, x1, y1 } = gradientLine(filter.tint.angle, w, h);
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [at, colour] of filter.tint.stops) gradient.addColorStop(at, colour);
    ctx.save();
    ctx.globalCompositeOperation = filter.tint.blend;
    ctx.globalAlpha = filter.tint.alpha;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (filter.vignette) {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${filter.vignette})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
