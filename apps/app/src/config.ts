import { ConfigClient, parseTrustedKeys, type LoadedConfig } from '@chillcall/rtc';
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

let loading: Promise<LoadedConfig> | undefined;
let loadedFor: string | undefined;

/**
 * The signed client config, loaded once per server address: verified, cached for offline starts, and
 * carrying fallback beacon addresses so servers can move without an app update. Public keys embedded at
 * build time (`VITE_TRUSTED_KEYS`) pin a CDN-served config; without them the server's own HTTPS origin is trusted.
 */
export function loadClientConfig(): Promise<LoadedConfig> {
  const server = getServerUrl();
  if (!loading || loadedFor !== server) {
    loadedFor = server;
    loading = new ConfigClient({
      beaconUrls: [server],
      trustedKeys: parseTrustedKeys(import.meta.env.VITE_TRUSTED_KEYS),
      storage: safeStorage(),
    }).load();
  }
  return loading;
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
