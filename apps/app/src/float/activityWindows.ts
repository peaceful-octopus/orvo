import { ACTIVITY_LABEL, placeBeside } from './bridge';

const SIZE_KEY = 'orvo:floatActivity';
const DEFAULT_SIZE = { w: 420, h: 360 };
const MIN_SIZE = { w: 240, h: 200 };
const GAP = 8;

/** The size the person last gave the activity window, in logical pixels. */
export function loadActivitySize(): { w: number; h: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as { w?: unknown; h?: unknown } | null;
    if (typeof saved?.w === 'number' && typeof saved.h === 'number' && saved.w >= MIN_SIZE.w && saved.h >= MIN_SIZE.h) return { w: saved.w, h: saved.h };
  } catch {
    // Storage can be unavailable; use the default.
  }
  return DEFAULT_SIZE;
}

export function saveActivitySize(size: { w: number; h: number }) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: Math.round(size.w), h: Math.round(size.h) }));
  } catch {
    // Not remembering the size is harmless.
  }
}

/** Window creation and closing are serialized so closing and reopening quickly cannot race. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (task: () => Promise<void>) => (queue = queue.then(task, task));

async function open() {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  if (await WebviewWindow.getByLabel(ACTIVITY_LABEL)) return;
  const size = loadActivitySize();
  const win = new WebviewWindow(ACTIVITY_LABEL, {
    url: 'index.html?view=activity',
    width: size.w,
    height: size.h,
    minWidth: MIN_SIZE.w,
    minHeight: MIN_SIZE.h,
    transparent: true,
    decorations: false,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    focus: true,
    visible: true,
  });
  await new Promise<void>((resolve) => {
    void win.once('tauri://created', () => resolve());
    void win.once('tauri://error', () => resolve());
  });

  // Start beside the bubbles; after that the person puts it wherever they like.
  try {
    const { Window, monitorFromPoint } = await import('@tauri-apps/api/window');
    const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
    const main = await Window.getByLabel('main');
    if (!main) return;
    const [pos, outer, scale] = await Promise.all([main.outerPosition(), main.outerSize(), win.scaleFactor()]);
    const monitor = await monitorFromPoint(pos.x + outer.width / 2, pos.y + outer.height / 2);
    const area = monitor
      ? { x: monitor.workArea.position.x, y: monitor.workArea.position.y, w: monitor.workArea.size.width, h: monitor.workArea.size.height }
      : { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
    const at = placeBeside({ x: pos.x, y: pos.y, w: outer.width, h: outer.height }, { w: size.w * scale, h: size.h * scale }, area, GAP * scale);
    await win.setPosition(new PhysicalPosition(at.x, at.y));
  } catch {
    // The window stays where the system put it.
  }
}

async function close() {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await (await WebviewWindow.getByLabel(ACTIVITY_LABEL))?.destroy();
}

/** Opens the activity's window, if it is not open. */
export const openActivityWindow = () => enqueue(open);

/** Closes the activity's window, if there is one, and resolves once it is gone. */
export const closeActivityWindow = () => enqueue(close);
