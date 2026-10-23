import { useCallback, useEffect, useRef, useState } from 'react';
import { registerThemeTarget } from '../theme/theme';
import { adaptiveMode, bubbleForWindow, FLOAT_BUBBLE, floatWindowSize, MAX_FLOAT_BUBBLE, MIN_FLOAT_BUBBLE, type LayoutMode } from './layouts';

export type FloatKind = 'tauri' | 'pip';

interface PipApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

const pipApi = () => (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;

export function floatKind(): FloatKind | null {
  if ('__TAURI_INTERNALS__' in window) return 'tauri';
  return pipApi() ? 'pip' : null;
}

function copyStyles(from: Document, to: Document) {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement('style');
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
      to.head.append(style);
    } catch {
      // Cross-origin stylesheets cannot be read; skip them.
    }
  }
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
 * Floating bubbles over other apps. In Tauri the app window itself becomes a small transparent
 * always-on-top window; elsewhere a Document Picture-in-Picture window hosts the bubbles.
 */
export function useFloat(mode: LayoutMode, count: number) {
  const kind = floatKind();
  const [active, setActive] = useState(false);
  const [pip, setPip] = useState<Window | null>(null);

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
      await win.setSize(new LogicalSize(size.w, size.h));
      document.documentElement.classList.add('floating');
      setActive(true);
    } else if (kind === 'pip') {
      const win = await pipApi()!.requestWindow({ width: size.w, height: size.h });
      copyStyles(document, win.document);
      const stopTheme = registerThemeTarget(win.document);
      win.document.documentElement.classList.add('floating', 'pip');
      win.addEventListener('pagehide', () => {
        stopTheme();
        setPip(null);
        setActive(false);
      });
      setPip(win);
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
      await win.setSize(new LogicalSize(saved.w, saved.h));
      setSaved(null);
    } else if (kind === 'pip') {
      pip?.close();
    }
    setActive(false);
  }, [kind, saved, pip]);

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
    } else {
      try {
        const size = fitted({ w: pip?.innerWidth ?? 0, h: pip?.innerHeight ?? 0 });
        pip?.resizeTo(size.w, size.h);
      } catch {
        // Browsers may refuse resizes without a user gesture.
      }
    }
  }, [active, kind, mode, count, pip]);

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

  return { kind, active, pip, enter, exit };
}

export async function startWindowDrag() {
  await (await tauriWindow()).startDragging();
}
