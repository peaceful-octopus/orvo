import { useCallback, useEffect, useRef, useState } from 'react';
import { adaptiveMode, bubbleForWindow, FLOAT_BUBBLE, floatWindowSize, MAX_FLOAT_BUBBLE, MIN_FLOAT_BUBBLE, type LayoutMode } from './layouts';

export type FloatKind = 'tauri';

/** Floating needs the desktop app's window control; a browser or an installed web app has none. */
export function floatKind(): FloatKind | null {
  return '__TAURI_INTERNALS__' in window ? 'tauri' : null;
}

/** Hides or restores the Windows 11 border that otherwise outlines the transparent floating window. */
async function setWindowBorder(visible: boolean) {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_window_border', { visible }).catch(() => {}); // Windows 10 and other systems have no such border
}

const BUBBLE_KEY = 'orvo:floatBubble';
/** Resize events this soon after the app's own resize are its own doing, not the person's. */
const OWN_RESIZE_MS = 700;
const SAVE_DELAY_MS = 400;
/**
 * Room a system dialog needs, such as the screen picker, which is drawn inside the window that asked for it. In
 * logical pixels, so the window already grows with the display scaling.
 */
const DIALOG_ROOM = { w: 640, h: 460 };
/** Effectively no minimum while floating. */
const FLOAT_MIN = { w: 1, h: 1 };
/** Mirrors minWidth and minHeight in tauri.conf.json, restored when the window docks again. */
const DOCKED_MIN = { w: 520, h: 620 };

function loadBubble(): number {
  try {
    const n = Number(localStorage.getItem(BUBBLE_KEY));
    if (n >= MIN_FLOAT_BUBBLE && n <= MAX_FLOAT_BUBBLE) return n;
  } catch {
    // Storage can be unavailable; use the default.
  }
  return FLOAT_BUBBLE;
}

function saveBubble(n: number) {
  try {
    localStorage.setItem(BUBBLE_KEY, String(n));
  } catch {
    // Not remembering the size is harmless.
  }
}

async function tauriWindow() {
  return (await import('@tauri-apps/api/window')).getCurrentWindow();
}

interface TauriSaved {
  w: number;
  h: number;
  decorated: boolean;
}

/**
 * Floating bubbles over other apps: the app window itself becomes a small transparent always-on-top window.
 */
export function useFloat(mode: LayoutMode, count: number) {
  const kind = floatKind();
  const [active, setActive] = useState(false);

  const [saved, setSaved] = useState<TauriSaved | null>(null);
  /** The bubble diameter the person last chose by resizing; the window is refitted to it as people come and go. */
  const bubble = useRef(loadBubble());
  const ownResizeAt = useRef(0);

  const enter = useCallback(async () => {
    const size = floatWindowSize(mode, count, bubble.current);
    ownResizeAt.current = Date.now();
    if (kind === 'tauri') {
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const win = await tauriWindow();
      const scale = await win.scaleFactor();
      const inner = (await win.innerSize()).toLogical(scale);
      setSaved({ w: inner.width, h: inner.height, decorated: await win.isDecorated() });
      await win.setDecorations(false);
      await win.setShadow(false); // the shadow draws a dark frame around the transparent window
      await setWindowBorder(false); // and Windows 11 adds a one-pixel outline even without it
      await win.setAlwaysOnTop(true);
      await win.setMinSize(new LogicalSize(FLOAT_MIN.w, FLOAT_MIN.h)); // the docked minimum would stop the window shrinking to a few bubbles; null does not lift it on Windows
      await win.setSize(new LogicalSize(size.w, size.h));
      document.documentElement.classList.add('floating');
      setActive(true);
    }
  }, [kind, mode, count]);

  const exit = useCallback(async () => {
    if (kind === 'tauri' && saved) {
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const win = await tauriWindow();
      document.documentElement.classList.remove('floating');
      await win.setAlwaysOnTop(false);
      await win.setShadow(true);
      await setWindowBorder(true);
      await win.setDecorations(saved.decorated);
      await win.setMinSize(new LogicalSize(DOCKED_MIN.w, DOCKED_MIN.h));
      await win.setSize(new LogicalSize(saved.w, saved.h));
      setSaved(null);
    }
    setActive(false);
  }, [kind, saved]);

  /**
   * Runs `task` with the floating window made big enough to hold a system dialog (the screen picker is drawn inside
   * the window and is unusable in a few bubbles' worth of space), then puts the window back as it was.
   */
  const withRoomyWindow = useCallback(
    async <T,>(task: () => Promise<T>): Promise<T> => {
      if (kind !== 'tauri' || !active) return task();
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const win = await tauriWindow();
      const before = (await win.innerSize()).toLogical(await win.scaleFactor());
      ownResizeAt.current = Date.now();
      await win.setSize(new LogicalSize(Math.max(before.width, DIALOG_ROOM.w), Math.max(before.height, DIALOG_ROOM.h)));
      try {
        return await task();
      } finally {
        ownResizeAt.current = Date.now();
        await win.setSize(new LogicalSize(before.width, before.height));
      }
    },
    [kind, active],
  );

  // Keep the floating window fitted to the layout as people come and go.
  useEffect(() => {
    if (!active) return;
    // A row or column keeps whichever way the window was stretched; the new count only changes its length.
    const fitted = (current: { w: number; h: number }) =>
      floatWindowSize(adaptiveMode(mode, count, current), count, bubble.current);
    if (kind === 'tauri') {
      ownResizeAt.current = Date.now();
      void import('@tauri-apps/api/dpi').then(async ({ LogicalSize }) => {
        const win = await tauriWindow();
        const inner = (await win.innerSize()).toLogical(await win.scaleFactor());
        const size = fitted({ w: inner.width, h: inner.height });
        await win.setSize(new LogicalSize(size.w, size.h));
      });
    }
  }, [active, kind, mode, count]);

  // Remember the size the person drags the window to, for the next time and the next session.
  useEffect(() => {
    if (!active || kind !== 'tauri') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    void tauriWindow().then(async (win) => {
      const off = await win.onResized(() => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          if (Date.now() - ownResizeAt.current < OWN_RESIZE_MS) return;
          const inner = (await win.innerSize()).toLogical(await win.scaleFactor());
          const size = { w: inner.width, h: inner.height };
          bubble.current = bubbleForWindow(adaptiveMode(mode, count, size), count, size);
          saveBubble(bubble.current);
        }, SAVE_DELAY_MS);
      });
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [active, kind, mode, count]);

  return { kind, active, enter, exit, withRoomyWindow };
}

export async function startWindowDrag() {
  await (await tauriWindow()).startDragging();
}
