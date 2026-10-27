import { ConfigClient, parseTrustedKeys, type LoadedConfig } from '@orvo/rtc';
import { configNeedsReload } from './configLogic';
import { normalizeServerUrl } from './serverUrl';

const STORAGE_KEY = 'orvo:server';

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

const TELEMETRY_KEY = 'orvo:telemetry';

/** Whether the user allows anonymous connection statistics (on unless they turned it off). */
export function telemetryAllowed(): boolean {
  try {
    return localStorage.getItem(TELEMETRY_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setTelemetryAllowed(allowed: boolean) {
  try {
    localStorage.setItem(TELEMETRY_KEY, allowed ? 'on' : 'off');
  } catch {
    // Without storage the choice cannot be remembered; reports still stop for this session via the caller.
  }
}

/**
 * The Giphy Web SDK key: the one the server publishes in its signed config. While developing, a key in
 * `apps/app/.env.local` (`VITE_GIPHY_API_KEY`) is used as well. Release builds never carry a key: `import.meta.env.DEV`
 * is false there, so the build drops that branch, and `vite.config.ts` fails the build if a key still turns up in the
 * output. Without a key GIFs are off.
 */
export function giphyApiKey(config: { integrations?: { giphyApiKey?: string } }): string | undefined {
  const developmentKey = import.meta.env.DEV ? import.meta.env.VITE_GIPHY_API_KEY : undefined;
  return config.integrations?.giphyApiKey || developmentKey || undefined;
}

let loading: Promise<LoadedConfig> | undefined;
let loaded: { server: string; at: number } | undefined;

/**
 * The signed client config: verified, cached for offline starts, and carrying fallback beacon addresses so servers can
 * move without an app update. Public keys embedded at build time (`VITE_TRUSTED_KEYS`) pin a CDN-served config; without
 * them the server's own HTTPS origin is trusted.
 *
 * It is loaded once per server address, and again once the one in hand is older than `maxAgeMs`, which is how changes an
 * operator makes on the server reach a page that stays open.
 */
export function loadClientConfig(options: { maxAgeMs?: number } = {}): Promise<LoadedConfig> {
  const server = getServerUrl();
  if (!loading || configNeedsReload(loaded, server, Date.now(), options.maxAgeMs)) {
    loaded = { server, at: Date.now() };
    loading = new ConfigClient({
      beaconUrls: [server],
      trustedKeys: parseTrustedKeys(import.meta.env.VITE_TRUSTED_KEYS),
      storage: safeStorage(),
      // A refresh of a config already in hand is for picking up changes, so it must not be answered from the browser's cache.
      bypassCache: options.maxAgeMs !== undefined,
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
