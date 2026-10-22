import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useConfig } from './configStore';
import { telemetry } from './telemetry';
import './styles.css';

void useConfig.getState().refresh();
telemetry.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
