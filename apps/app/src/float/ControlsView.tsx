import type { GifMode, GifSource } from '@chillcall/effects';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ControlButtons } from './ControlButtons';
import {
  EVT_ACTION,
  EVT_CONTROLS_HOVER,
  EVT_MAIN_HOVER,
  EVT_READY,
  EVT_STATE,
  placeControls,
  type ControlAction,
  type ControlsState,
} from './bridge';
import { CONTROLS_BAR } from './controlsWindow';

const GifPicker = lazy(() => import('../GifPicker'));

const PICKER = { w: 480, h: 620 };
const HIDE_DELAY_MS = 300;
/** Space between the bubble window and the controls, in logical pixels. */
const GAP = 4;

/** Contents of the separate controls window: fades in over the bubble window and follows it. */
export function ControlsView() {
  const [state, setState] = useState<ControlsState>({ audio: true, video: true });
  const [mainHover, setMainHover] = useState(false);
  const [selfHover, setSelfHover] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lingering, setLingering] = useState(false);
  const [above, setAbove] = useState(false);

  const shown = mainHover || selfHover || pickerOpen || lingering;

  // Stay visible briefly after the pointer leaves so it can cross the gap between the two windows.
  useEffect(() => {
    if (mainHover || selfHover) {
      setLingering(true);
      return;
    }
    const t = setTimeout(() => setLingering(false), HIDE_DELAY_MS);
    return () => clearTimeout(t);
  }, [mainHover, selfHover]);

  const act = useCallback(async (action: ControlAction) => {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(EVT_ACTION, action);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('floating');
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    void (async () => {
      const { emit, listen } = await import('@tauri-apps/api/event');
      const subs = await Promise.all([
        listen<ControlsState>(EVT_STATE, (e) => setState(e.payload)),
        listen<boolean>(EVT_MAIN_HOVER, (e) => setMainHover(e.payload)),
      ]);
      if (cancelled) return subs.forEach((u) => u());
      unlisten.push(...subs);
      await emit(EVT_READY);
    })();
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_window_border', { visible: false }).catch(() => {}));
    return () => {
      cancelled = true;
      unlisten.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    void import('@tauri-apps/api/event').then(({ emit }) => emit(EVT_CONTROLS_HOVER, selfHover));
  }, [selfHover]);

  // While hidden the window is transparent and must let clicks through to whatever is underneath.
  useEffect(() => {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setIgnoreCursorEvents(!shown));
  }, [shown]);

  // Size for the bar or the GIF picker, and keep the window beside the bubble window as it moves or resizes.
  useEffect(() => {
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    void (async () => {
      const { getCurrentWindow, monitorFromPoint, Window } = await import('@tauri-apps/api/window');
      const { LogicalSize, PhysicalPosition } = await import('@tauri-apps/api/dpi');
      const me = getCurrentWindow();
      const main = await Window.getByLabel('main');
      if (!main) return;
      const logical = pickerOpen ? PICKER : CONTROLS_BAR;
      await me.setSize(new LogicalSize(logical.w, logical.h));

      const place = async () => {
        const [pos, outer, scale] = await Promise.all([main.outerPosition(), main.outerSize(), me.scaleFactor()]);
        const monitor = await monitorFromPoint(pos.x + outer.width / 2, pos.y + outer.height / 2);
        const size = { w: logical.w * scale, h: logical.h * scale };
        const area = monitor
          ? { x: monitor.position.x, y: monitor.position.y, w: monitor.size.width, h: monitor.size.height }
          : { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
        const p = placeControls({ x: pos.x, y: pos.y, w: outer.width, h: outer.height }, size, area, GAP * scale);
        setAbove(p.above);
        await me.setPosition(new PhysicalPosition(p.x, p.y));
      };

      await place();
      const subs = await Promise.all([main.onMoved(() => void place()), main.onResized(() => void place())]);
      if (cancelled) return subs.forEach((u) => u());
      unlisten.push(...subs);
    })();
    return () => {
      cancelled = true;
      unlisten.forEach((u) => u());
    };
  }, [pickerOpen]);

  const pick = (source: GifSource, mode: GifMode) => {
    setPickerOpen(false);
    void act({ type: 'gif', source, mode });
  };

  return (
    <div
      className={`controls-view${shown ? ' shown' : ''}${above ? ' above' : ''}`}
      onMouseEnter={() => setSelfHover(true)}
      onMouseLeave={() => setSelfHover(false)}
    >
      <ControlButtons
        audio={state.audio}
        video={state.video}
        onToggleAudio={() => void act({ type: 'audio' })}
        onToggleVideo={() => void act({ type: 'video' })}
        onReact={(emoji) => void act({ type: 'react', emoji })}
        onExpand={() => void act({ type: 'expand' })}
        onGif={state.giphyKey ? () => setPickerOpen(true) : undefined}
      />
      {pickerOpen && state.giphyKey && (
        <Suspense fallback={null}>
          <GifPicker apiKey={state.giphyKey} onClose={() => setPickerOpen(false)} onPick={pick} />
        </Suspense>
      )}
    </div>
  );
}
