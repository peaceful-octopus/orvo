import { easeOutBack } from './particles';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The largest rectangle with the source's shape that covers the target, centered (like CSS `object-fit: cover`). */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** The largest rectangle with the source's shape that fits inside the target, centered (like `object-fit: contain`). */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

const POP_IN_MS = 260;
const POP_OUT_MS = 200;

export interface StickerPlacement extends Rect {
  alpha: number;
}

/**
 * Where a GIF sits when shown on top of the video: centered in the lower part of the frame, at up to `maxShare`
 * of the frame's width and height, popping in and shrinking away at the ends of its time.
 */
export function stickerPlacement(
  gifW: number,
  gifH: number,
  canvasW: number,
  canvasH: number,
  ageMs: number,
  durationMs: number,
  maxShare = 0.62,
): StickerPlacement {
  const fit = containRect(gifW, gifH, canvasW * maxShare, canvasH * maxShare);
  const popIn = easeOutBack(ageMs / POP_IN_MS);
  const remaining = durationMs - ageMs;
  const popOut = remaining >= POP_OUT_MS ? 1 : Math.max(0, remaining / POP_OUT_MS);
  const scale = Math.max(0, popIn) * popOut;

  const w = fit.w * scale;
  const h = fit.h * scale;
  const cx = canvasW / 2;
  const cy = canvasH * 0.58;
  return { x: cx - w / 2, y: cy - h / 2, w, h, alpha: Math.min(1, ageMs / 120) * popOut };
}

/** How far through its time a `fill` GIF is faded in or out, so replacing the video is not a hard cut. */
export function fillAlpha(ageMs: number, durationMs: number, fadeMs = 200): number {
  const remaining = durationMs - ageMs;
  return Math.max(0, Math.min(1, ageMs / fadeMs, remaining / fadeMs));
}
