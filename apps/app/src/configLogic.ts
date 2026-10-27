import { PROTOCOL_VERSION, isClientSupported, type ClientConfig } from '@orvo/protocol';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DISMISSED_KEY = 'orvo:dismissed-notices';

/**
 * Whether the config loaded earlier must be fetched again: it is for another server, or older than `maxAgeMs`. Without a
 * `maxAgeMs` a config loaded for this server is kept for as long as the page is open.
 */
export function configNeedsReload(
  loaded: { server: string; at: number } | undefined,
  server: string,
  now: number,
  maxAgeMs?: number,
): boolean {
  if (!loaded || loaded.server !== server) return true;
  return maxAgeMs !== undefined && now - loaded.at > maxAgeMs;
}

/** True when this build is older than the server's minimum client version or speaks an older protocol. */
export function updateRequired(config: ClientConfig, clientVersion: string): boolean {
  return !isClientSupported({ version: clientVersion, protocol: PROTOCOL_VERSION }, config);
}

function dismissedIds(storage: KeyValueStorage | undefined): string[] {
  try {
    const raw = storage?.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** The announcement to show, unless the user already dismissed this one. */
export function visibleAnnouncement(config: ClientConfig, storage: KeyValueStorage | undefined) {
  const { announcement } = config;
  return announcement && !dismissedIds(storage).includes(announcement.id) ? announcement : undefined;
}

/** Remembers a dismissal so the same announcement stays hidden; a new `id` shows again. */
export function dismissAnnouncement(id: string, storage: KeyValueStorage | undefined) {
  try {
    const ids = [...new Set([...dismissedIds(storage), id])].slice(-20);
    storage?.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable; the notice just reappears next time.
  }
}
