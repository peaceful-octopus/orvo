import { normalizeServerUrl } from './serverUrl';

const STORAGE_KEY = 'chillcall:server';

// A packaged Tauri app is served from tauri.localhost, so the page's own origin is not the server.
const inTauri = '__TAURI_INTERNALS__' in window;

export const CLIENT_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

export function defaultServerUrl(): string {
  return import.meta.env.VITE_BEACON_URL ?? (inTauri ? 'http://localhost:8080' : location.origin);
}

/** The beacon this app talks to: the user's setting, else the build-time default, else this site's own origin. */
export function getServerUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch {
    // Storage can be unavailable; fall through to the default.
  }
  return defaultServerUrl();
}

/** Saves the server setting; returns false if the input is not a usable address. Empty input resets it. */
export function setServerUrl(input: string): boolean {
  const normalized = normalizeServerUrl(input);
  if (normalized === null) return false;
  try {
    if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  return true;
}
