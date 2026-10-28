import type { GifMode, GifSource } from '@orvo/effects';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { DeviceMenuPanel, menuRows, type MenuKind } from '../DeviceMenu';
import { noDevices, noSelection } from '../devices';
import { FilterPanel, lookIsOn } from '../FilterMenu';
import { ControlButtons } from './ControlButtons';
import {
  EVT_ACTION,
  EVT_CONTROLS_HOVER,
  EVT_MAIN_HOVER,
  EVT_READY,
  EVT_STATE,
  EVT_TOAST,
  placeControls,
  type ControlAction,
  type ControlsState,
} from './bridge';
import { ToastCard } from '../Toasts';
import type { Toast } from '../toastStore';
import { CONTROLS_BAR } from './controlsWindow';

const GifPicker = lazy(() => import('../GifPicker'));

const PICKER = { w: 480, h: 560 };
const HIDE_DELAY_MS = 300;
const POLL_MS = 60;
/** Tallest the device menu's window grows; longer lists scroll. */
const MENU_MAX = 420;
/** Height of the filters panel: three rows of swatches and two switches. */
const FILTERS_HEIGHT = 270;
/** Room for one message under the controls. */
const TOAST_HEIGHT = 56;
/** Space between the bubble window and the controls, in logical pixels. */
const GAP = 4;

/**
 * The window is wider than the panel it shows, so most of it is transparent. Only the controls, menus and picker count
 * as the pointer being over the call; the empty area around them does not, so the bubbles do not react to it.
 */
const overContent = (e: React.MouseEvent<HTMLElement>) => {
  const target = e.target as HTMLElement;
  return target !== e.currentTarget && !target.classList.contains('modal-backdrop');
};

/** True when this element is part of the controls, menus or picker and not the transparent area around them. */
const isContent = (el: Element | null) => el !== null && !el.classList.contains('controls-view') && !el.classList.contains('modal-backdrop') && el !== document.body && el !== document.documentElement;

/** Contents of the separate controls window: fades in over the bubble window and follows it. */
export function ControlsView() {
  const [state, setState] = useState<ControlsState>({
    audio: true,
    video: true,
    devices: noDevices(),
    selected: noSelection(),
    canSelectOutput: false,
    filter: 'none',
    blurBackground: false,
    autoFrame: false,
    sharing: false,
    canShare: false,
  });
  const [mainHover, setMainHover] = useState(false);
  const [selfHover, setSelfHover] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menu, setMenu] = useState<MenuKind | 'filters' | null>(null);
  const panelOpen = pickerOpen || menu !== null;
  const [lingering, setLingering] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [above, setAbove] = useState(false);

  const rows = menu && menu !== 'filters' ? menuRows(menu, state.devices, state.canSelectOutput) : { sections: 0, options: 0 };
  const menuHeight = menu === 'filters' ? FILTERS_HEIGHT : Math.min(MENU_MAX, 20 + rows.sections * 34 + rows.options * 36);

  const shown = mainHover || selfHover || panelOpen || lingering || toast !== null;

  // Stay visible briefly after the pointer leaves so it can cross the gap between the two windows.
  useEffect(() => {
    if (mainHover || selfHover) {
      setLingering(true);
      return;
    }
    const t = setTimeout(() => setLingering(false), HIDE_DELAY_MS);
    return () => clearTimeout(t);
  }, [mainHover, selfHover]);

  // macOS gives a window that is not focused no mouse-move events, and this one never takes focus, so the page cannot
  // tell the pointer is over it. While it is showing, find out by comparing the cursor with the window, as the bubble
  // window does.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow, cursorPosition }) => {
      if (cancelled) return;
      const me = getCurrentWindow();
      timer = setInterval(() => {
        if (!shownRef.current) return;
        void Promise.all([cursorPosition(), me.outerPosition(), me.outerSize(), me.scaleFactor()])
          .then(([c, p, s, scale]) => {
            const x = c.x - p.x;
            const y = c.y - p.y;
            const inside = x >= 0 && y >= 0 && x < s.width && y < s.height;
            setSelfHover(inside && isContent(document.elementFromPoint(x / scale, y / scale)));
          })
          .catch(() => {});
      }, POLL_MS);
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Escape closes whichever panel is open.
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [menu]);

  // A message stays for a few seconds, then the controls fade away again.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

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
        listen<Toast>(EVT_TOAST, (e) => setToast(e.payload)),
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
      const base = pickerOpen ? PICKER : menu ? { w: CONTROLS_BAR.w, h: CONTROLS_BAR.h + menuHeight } : CONTROLS_BAR;
      const logical = toast ? { w: base.w, h: base.h + TOAST_HEIGHT } : base;
      await me.setSize(new LogicalSize(logical.w, logical.h));

      const place = async () => {
        const [pos, outer, scale] = await Promise.all([main.outerPosition(), main.outerSize(), me.scaleFactor()]);
        const monitor = await monitorFromPoint(pos.x + outer.width / 2, pos.y + outer.height / 2);
        const size = { w: logical.w * scale, h: logical.h * scale };
        const area = monitor
          ? { x: monitor.workArea.position.x, y: monitor.workArea.position.y, w: monitor.workArea.size.width, h: monitor.workArea.size.height }
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
  }, [pickerOpen, menu, menuHeight, toast !== null]);

  const toggleMenu = (next: MenuKind | 'filters') => {
    setPickerOpen(false);
    setMenu((current) => (current === next ? null : next));
  };

  const pick = (source: GifSource, mode: GifMode) => {
    setPickerOpen(false);
    void act({ type: 'gif', source, mode });
  };

  return (
    <div
      className={`controls-view${shown ? ' shown' : ''}${above ? ' above' : ''}`}
      onMouseMove={(e) => setSelfHover(overContent(e))}
      onMouseLeave={() => setSelfHover(false)}
      onMouseDown={(e) => e.target === e.currentTarget && setMenu(null)}
    >
      <ControlButtons
        audio={state.audio}
        video={state.video}
        onToggleAudio={() => void act({ type: 'audio' })}
        onToggleVideo={() => void act({ type: 'video' })}
        onReact={(emoji) => void act({ type: 'react', emoji })}
        onExpand={() => void act({ type: 'expand' })}
        onLeave={() => void act({ type: 'leave' })}
        onGif={
          state.giphyKey
            ? () => {
                setMenu(null);
                setPickerOpen(true);
              }
            : undefined
        }
        onDeviceMenu={toggleMenu}
        openMenu={menu}
        onFilters={() => toggleMenu('filters')}
        filterOn={lookIsOn(state)}
        onShare={state.canShare ? () => void act({ type: 'share' }) : undefined}
        sharing={state.sharing}
      />
      {menu === 'filters' && (
        <FilterPanel
          look={state}
          onFilter={(id) => void act({ type: 'filter', id })}
          onToggle={(which, on) => void act({ type: 'look', which, on })}
        />
      )}
      {menu && menu !== 'filters' && (
        <DeviceMenuPanel
          menu={menu}
          devices={state.devices}
          selected={state.selected}
          canSelectOutput={state.canSelectOutput}
          onSelect={(kind, id) => void act({ type: 'device', kind, id })}
        />
      )}
      {toast && <ToastCard toast={toast} onDismiss={() => setToast(null)} />}
      {pickerOpen && state.giphyKey && (
        <Suspense fallback={null}>
          <GifPicker apiKey={state.giphyKey} onClose={() => setPickerOpen(false)} onPick={pick} />
        </Suspense>
      )}
    </div>
  );
}
