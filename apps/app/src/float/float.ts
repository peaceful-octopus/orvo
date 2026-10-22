import { useCallback, useEffect, useState } from 'react';
import { floatWindowSize, type LayoutMode } from './layouts';

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

  const enter = useCallback(async () => {
    const size = floatWindowSize(mode, count);
    if (kind === 'tauri') {
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const win = await tauriWindow();
      const scale = await win.scaleFactor();
      const inner = (await win.innerSize()).toLogical(scale);
      setSaved({ w: inner.width, h: inner.height, decorated: await win.isDecorated() });
      await win.setDecorations(false);
      await win.setAlwaysOnTop(true);
      await win.setSize(new LogicalSize(size.w, size.h));
      document.documentElement.classList.add('floating');
      setActive(true);
    } else if (kind === 'pip') {
      const win = await pipApi()!.requestWindow({ width: size.w, height: size.h });
      copyStyles(document, win.document);
      win.document.documentElement.classList.add('floating', 'pip');
      win.addEventListener('pagehide', () => {
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
    const size = floatWindowSize(mode, count);
    if (kind === 'tauri') {
      void import('@tauri-apps/api/dpi').then(async ({ LogicalSize }) =>
        (await tauriWindow()).setSize(new LogicalSize(size.w, size.h)),
      );
    } else {
      try {
        pip?.resizeTo(size.w, size.h);
      } catch {
        // Browsers may refuse resizes without a user gesture.
      }
    }
  }, [active, kind, mode, count, pip]);

  return { kind, active, pip, enter, exit };
}

export async function startWindowDrag() {
  await (await tauriWindow()).startDragging();
}
