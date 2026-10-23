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
import { startTheme } from './theme/theme';
import './styles.css';

// The floating view's controls run in their own window; it only relays button presses to the call window.
const controlsOnly = new URLSearchParams(location.search).get('view') === 'controls';

startTheme();

if (!controlsOnly) {
  void useConfig.getState().refresh();
  telemetry.start();
  // A reload can leave the previous page's controls window behind with nothing to control.
  if ('__TAURI_INTERNALS__' in window) void closeControlsWindow().catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">{controlsOnly ? <ControlsView /> : <App />}</MotionConfig>
  </StrictMode>,
);
