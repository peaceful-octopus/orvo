import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/dm-sans';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useConfig } from './configStore';
import { ControlsView } from './float/ControlsView';
import { closeControlsWindow } from './float/controlsWindow';
import { telemetry } from './telemetry';
import { startUpdateChecks } from './updater';
import { startTheme } from './theme/theme';
import './styles.css';

// The floating view's controls run in their own window; it only relays button presses to the call window.
const controlsOnly = new URLSearchParams(location.search).get('view') === 'controls';

startTheme();

// The desktop app's right-click menu is the web view's (Share, Reload and so on), which means nothing in an app. Text
// fields keep theirs for cut and paste, and the development build keeps it for Inspect.
if ('__TAURI_INTERNALS__' in window && !import.meta.env.DEV) {
  window.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]'))) e.preventDefault();
  });
}

// The web view also steps through history with the mouse's Back and Forward buttons and Alt+Left and Alt+Right. The app
// does its own navigation, and those would land on pages that no longer make sense, such as a finished call.
if ('__TAURI_INTERNALS__' in window) {
  const isHistoryButton = (e: MouseEvent) => e.button === 3 || e.button === 4;
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'] as const) {
    window.addEventListener(type, (e) => isHistoryButton(e) && e.preventDefault(), true);
  }
  window.addEventListener(
    'keydown',
    (e) => e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.preventDefault(),
    true,
  );
}

if (!controlsOnly) {
  void useConfig.getState().refresh();
  telemetry.start();
  startUpdateChecks();
  // A reload can leave the previous page's controls window behind with nothing to control.
  if ('__TAURI_INTERNALS__' in window) void closeControlsWindow().catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">{controlsOnly ? <ControlsView /> : <App />}</MotionConfig>
  </StrictMode>,
);
