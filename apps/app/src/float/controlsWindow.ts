import { useEffect, useRef, useState } from 'react';
import { useToasts } from '../toastStore';
import {
  CONTROLS_LABEL,
  EVT_ACTION,
  EVT_CONTROLS_HOVER,
  EVT_MAIN_HOVER,
  EVT_READY,
  EVT_STATE,
  EVT_TOAST,
  type ControlAction,
  type ControlsState,
} from './bridge';

const HOVER_POLL_MS = 60;
const HOVER_MARGIN_PX = 8;

export const CONTROLS_BAR = { w: 544, h: 64 };

/** Window creation and closing are serialized so a quick Float/Expand toggle cannot race itself. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (task: () => Promise<void>) => (queue = queue.then(task, task));

async function openControls() {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  if (await WebviewWindow.getByLabel(CONTROLS_LABEL)) return;
  const win = new WebviewWindow(CONTROLS_LABEL, {
    url: 'index.html?view=controls',
    width: CONTROLS_BAR.w,
    height: CONTROLS_BAR.h,
    transparent: true,
    decorations: false,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focus: false,
    visible: true,
  });
  await new Promise<void>((resolve) => {
    void win.once('tauri://created', () => resolve());
    void win.once('tauri://error', () => resolve());
  });
}

async function closeControls() {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await (await WebviewWindow.getByLabel(CONTROLS_LABEL))?.destroy();
}

/**
 * While the floating window is active, runs the separate controls window next to it: keeps it in sync with the
 * call state, performs its actions, and reports whether the pointer is over either window (the bubble window
 * shows a translucent background while it is).
 */
export function useControlsWindow(
  active: boolean,
  state: ControlsState,
  onAction: (action: ControlAction) => void,
): { hot: boolean } {
  const [mainHover, setMainHover] = useState(false);
  const [controlsHover, setControlsHover] = useState(false);
  const stateRef = useRef(state);
  const actionRef = useRef(onAction);
  stateRef.current = state;
  actionRef.current = onAction;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const unlisten: (() => void)[] = [];

    void (async () => {
      const { emit, listen } = await import('@tauri-apps/api/event');
      const subscriptions = await Promise.all([
        listen(EVT_READY, () => void emit(EVT_STATE, stateRef.current)),
        listen<ControlAction>(EVT_ACTION, (e) => actionRef.current(e.payload)),
        listen<boolean>(EVT_CONTROLS_HOVER, (e) => setControlsHover(e.payload)),
      ]);
      if (cancelled) return subscriptions.forEach((u) => u());
      unlisten.push(...subscriptions);

      // The OS handles the resize border itself, so the page gets no mouse events there. Poll the cursor against
      // the window's outer rectangle instead, with a margin that covers the border's grab zone.
      const { getCurrentWindow, cursorPosition } = await import('@tauri-apps/api/window');
      const me = getCurrentWindow();
      let last = false;
      const timer = setInterval(() => {
        void Promise.all([cursorPosition(), me.outerPosition(), me.outerSize()])
          .then(([c, p, s]) => {
            const m = HOVER_MARGIN_PX;
            const hover = c.x >= p.x - m && c.x < p.x + s.width + m && c.y >= p.y - m && c.y < p.y + s.height + m;
            if (hover === last) return;
            last = hover;
            setMainHover(hover);
            void emit(EVT_MAIN_HOVER, hover);
          })
          .catch(() => {});
      }, HOVER_POLL_MS);
      unlisten.push(() => clearInterval(timer));
      void enqueue(openControls);
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((u) => u());
      setMainHover(false);
      setControlsHover(false);
      void enqueue(closeControls);
    };
  }, [active]);

  // The call window is too small to show messages while floating, so they appear beside the controls instead.
  useEffect(() => {
    if (!active) return;
    let seen = new Set(useToasts.getState().toasts.map((t) => t.id));
    return useToasts.subscribe((s) => {
      for (const t of s.toasts) {
        if (!seen.has(t.id)) void import('@tauri-apps/api/event').then(({ emit }) => emit(EVT_TOAST, t));
      }
      seen = new Set(s.toasts.map((t) => t.id));
    });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void import('@tauri-apps/api/event').then(({ emit }) => emit(EVT_STATE, state));
  }, [active, state.audio, state.video, state.giphyKey, state.devices, state.selected, state.canSelectOutput, state.filter, state.blurBackground, state.autoFrame, state.sharing, state.canShare]);

  return { hot: mainHover || controlsHover };
}
