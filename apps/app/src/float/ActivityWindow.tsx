import { useEffect, useRef, useState } from 'react';
import { saveActivitySize } from './activityWindows';
import { EVT_ACTIVITY_CLOSE, EVT_ACTIVITY_FROM_FRAME, EVT_ACTIVITY_INFO, EVT_ACTIVITY_READY, EVT_ACTIVITY_TO_FRAME, type ActivityWindowInfo } from './bridge';
import { startWindowDrag } from './float';
import { RemoveIcon } from './icons';

const SAVE_DELAY_MS = 400;

const emitEvent = async (name: string, payload?: unknown) => (await import('@tauri-apps/api/event')).emit(name, payload);

/** Contents of the activity's own window: the sandboxed frame, with a title bar to drag it by. */
export function ActivityWindow() {
  const [info, setInfo] = useState<ActivityWindowInfo | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    document.documentElement.classList.add('floating');
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    // Only the frame this window created is believed.
    const fromFrame = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow) void emitEvent(EVT_ACTIVITY_FROM_FRAME, event.data);
    };
    window.addEventListener('message', fromFrame);

    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const subscriptions = await Promise.all([
        listen<ActivityWindowInfo>(EVT_ACTIVITY_INFO, (e) => setInfo(e.payload)),
        // The frame has no origin of its own to name.
        listen<unknown>(EVT_ACTIVITY_TO_FRAME, (e) => frame.current?.contentWindow?.postMessage(e.payload, '*')),
        win.onCloseRequested(() => void emitEvent(EVT_ACTIVITY_CLOSE)),
        // Remember the size the person drags the window to.
        win.onResized(() => {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(async () => {
            const inner = (await win.innerSize()).toLogical(await win.scaleFactor());
            saveActivitySize({ w: inner.width, h: inner.height });
          }, SAVE_DELAY_MS);
        }),
      ]);
      if (cancelled) return subscriptions.forEach((u) => u());
      unlisten.push(...subscriptions);
      await emitEvent(EVT_ACTIVITY_READY);
    })();

    return () => {
      cancelled = true;
      clearTimeout(saveTimer);
      window.removeEventListener('message', fromFrame);
      unlisten.forEach((u) => u());
    };
  }, []);

  return (
    <figure className="activity-window">
      <header onMouseDown={() => void startWindowDrag()}>
        <span>{info?.caption}</span>
        {info && (
          <button
            className="icon"
            aria-label={info.closeLabel}
            title={info.closeLabel}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void emitEvent(EVT_ACTIVITY_CLOSE)}
          >
            <RemoveIcon />
          </button>
        )}
      </header>
      {info && (
        <iframe ref={frame} src={info.src} title={info.title} sandbox="allow-scripts" allow="" referrerPolicy="no-referrer" onLoad={() => frame.current?.focus()} />
      )}
    </figure>
  );
}
