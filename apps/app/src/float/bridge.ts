import type { GifMode, GifSource } from '@orvo/effects';
import type { DeviceKind, DeviceLists, DeviceSelection } from '../devices';

/** Events exchanged between the floating bubble window and its separate controls window. */
export const CONTROLS_LABEL = 'float-controls';
export const EVT_STATE = 'float:state';
export const EVT_READY = 'float:ready';
export const EVT_ACTION = 'float:action';
export const EVT_MAIN_HOVER = 'float:main-hover';
export const EVT_CONTROLS_HOVER = 'float:controls-hover';
/** A message for the person to see while the call window is small. */
export const EVT_TOAST = 'float:toast';

export interface ControlsState {
  audio: boolean;
  video: boolean;
  giphyKey?: string;
  devices: DeviceLists;
  selected: DeviceSelection;
  canSelectOutput: boolean;
  /** The chosen mood filter, and whether background blur and framing are on. */
  filter: string;
  blurBackground: boolean;
  autoFrame: boolean;
  /** Whether you are sharing your screen, and whether this system can. */
  sharing: boolean;
  canShare: boolean;
}

export type ControlAction =
  | { type: 'audio' }
  | { type: 'video' }
  | { type: 'react'; emoji: string }
  | { type: 'gif'; source: GifSource; mode: GifMode }
  | { type: 'expand' }
  | { type: 'device'; kind: DeviceKind; id: string }
  | { type: 'filter'; id: string }
  | { type: 'share' }
  | { type: 'look'; which: 'blurBackground' | 'autoFrame'; on: boolean }
  | { type: 'leave' };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the controls window goes, in physical pixels: centered under the bubble window, or above it when there
 * is no room below, and never off the monitor.
 */
export function placeControls(main: Rect, size: { w: number; h: number }, monitor: Rect, gap: number) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const x = clamp(main.x + (main.w - size.w) / 2, monitor.x, monitor.x + monitor.w - size.w);
  const below = main.y + main.h + gap;
  const aboveY = main.y - gap - size.h;
  const above = below + size.h > monitor.y + monitor.h && aboveY >= monitor.y;
  // With no room on either side, overlap the bubbles rather than leave the window off the monitor.
  const y = clamp(above ? aboveY : below, monitor.y, monitor.y + monitor.h - size.h);
  return { x: Math.round(x), y: Math.round(y), above };
}
