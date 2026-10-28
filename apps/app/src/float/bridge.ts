import type { GifMode, GifSource } from '@orvo/effects';
import type { ActivityOption, RunningActivity } from '../activities/ActivityPanel';
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
  /** What the Play menu offers, and the activity running in the call. */
  activities: ActivityOption[];
  activity?: RunningActivity;
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
  | { type: 'activity-start'; id: string }
  | { type: 'activity-open' }
  | { type: 'activity-close' }
  | { type: 'look'; which: 'blurBackground' | 'autoFrame'; on: boolean }
  | { type: 'leave' };

/** The activity's own floating window, and the events it exchanges with the call window. */
export const ACTIVITY_LABEL = 'float-activity';
/** The activity window has loaded and wants to know what to show. */
export const EVT_ACTIVITY_READY = 'float:activity-ready';
export const EVT_ACTIVITY_INFO = 'float:activity-info';
/** A message from the call for the activity's frame, and a message the frame posted for the call. */
export const EVT_ACTIVITY_TO_FRAME = 'float:activity-to-frame';
export const EVT_ACTIVITY_FROM_FRAME = 'float:activity-from-frame';
/** The person closed the activity window. */
export const EVT_ACTIVITY_CLOSE = 'float:activity-close';

export interface ActivityWindowInfo {
  src: string;
  title: string;
  caption: string;
  closeLabel: string;
}

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

/**
 * Where the activity window first goes, in physical pixels: to the right of the bubble window, or to its left when
 * there is no room, and never off the monitor.
 */
export function placeBeside(main: Rect, size: { w: number; h: number }, monitor: Rect, gap: number) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const right = main.x + main.w + gap;
  const left = main.x - gap - size.w;
  const x = right + size.w <= monitor.x + monitor.w ? right : left >= monitor.x ? left : right;
  return { x: Math.round(clamp(x, monitor.x, monitor.x + monitor.w - size.w)), y: Math.round(clamp(main.y, monitor.y, monitor.y + monitor.h - size.h)) };
}
