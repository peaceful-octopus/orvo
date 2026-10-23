import type { FaceBox } from './vision';

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The face fills about this fraction of the picture's height once framed. */
const FACE_FRACTION = 0.34;
/** Never zoom in further than this: the picture would turn soft. */
export const MAX_ZOOM = 1.9;
/** Where the face sits from the top of the framed picture. */
const FACE_HEIGHT_AT = 0.4;
/** Movements smaller than this fraction of the crop are ignored, so a steady head does not make the picture drift. */
const DEADBAND = 0.04;

export const fullFrame = (vw: number, vh: number): Crop => ({ x: 0, y: 0, w: vw, h: vh });

/** The crop, with the picture's own proportions, that puts `face` at a comfortable size near the middle. */
export function targetCrop(face: FaceBox | undefined, vw: number, vh: number): Crop {
  if (!face) return fullFrame(vw, vh);
  const height = Math.min(vh, Math.max(vh / MAX_ZOOM, face.h / FACE_FRACTION));
  const width = height * (vw / vh);
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), vw - width);
  const y = Math.min(Math.max(cy - height * FACE_HEIGHT_AT, 0), vh - height);
  return { x, y, w: width, h: height };
}

/**
 * Moves `current` toward `target` over time (exponentially, with time constant `tauMs`), ignoring changes smaller
 * than a few percent of the picture so it holds still when you do.
 */
export function stepCrop(current: Crop, target: Crop, dtMs: number, tauMs = 700): Crop {
  const shift = Math.max(
    Math.abs(target.x - current.x) / current.w,
    Math.abs(target.y - current.y) / current.h,
    Math.abs(target.w - current.w) / current.w,
  );
  if (shift < DEADBAND) return current;
  const k = 1 - Math.exp(-dtMs / tauMs);
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
    w: current.w + (target.w - current.w) * k,
    h: current.h + (target.h - current.h) * k,
  };
}
