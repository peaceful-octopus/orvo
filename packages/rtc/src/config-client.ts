import {
  DEFAULT_VIDEO_TIERS,
  MAX_ROOM_SIZE,
  PROTOCOL_VERSION,
  WARN_ROOM_SIZE,
  fromBase64Url,
  verifyConfig,
  type ClientConfig,
  type KeyRing,
} from '@orvo/protocol';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ConfigClientOptions {
  /** Beacons to ask, in preference order. The loaded config can add more. */
  beaconUrls: string[];
  /**
   * Public keys embedded in the app. Without them the client trusts the keys its beacon serves over
   * HTTPS (the single-server case, where the TLS origin is the trust anchor).
   */
  trustedKeys?: KeyRing;
  storage?: KeyValueStorage;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long past `validUntil` a cached config is still honored when no fresh one can be fetched. */
  graceMs?: number;
  timeoutMs?: number;
  /** Ask the server even when the browser holds a recent copy of the config (it is served with a short max-age). */
  bypassCache?: boolean;
}

export type ConfigSource = 'network' | 'cache' | 'default';

export interface LoadedConfig {
  config: ClientConfig;
  source: ConfigSource;
}

interface CachedConfig {
  signed: unknown;
  keys?: Record<string, string>;
}

const CACHE_KEY = 'orvo:config';
const WEEK_MS = 7 * 24 * 3600_000;

/** Config used until a signed one arrives, so the app still works when no beacon can be reached. */
export function defaultConfig(beaconUrls: string[], now = Date.now()): ClientConfig {
  return {
    version: 0,
    issuedAt: now,
    validUntil: now,
    minClientVersion: '0.0.0',
    minProtocol: PROTOCOL_VERSION,
    beaconUrls,
    limits: { maxRoomSize: MAX_ROOM_SIZE, warnRoomSize: WARN_ROOM_SIZE, videoTiers: DEFAULT_VIDEO_TIERS },
    features: {},
    ice: { stunUrls: [] },
    regions: [],
  };
}

/**
 * Loads the signed client config: tries each beacon in turn, verifies the signature, refuses rollbacks,
 * and falls back to the last good copy and then to built-in defaults. Servers can therefore move
 * without an app update, as long as one known beacon address still answers.
 */
export class ConfigClient {
  private fetchImpl: typeof fetch;
  private now: () => number;
  private graceMs: number;
  private timeoutMs: number;

  constructor(private opts: ConfigClientOptions) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.now = opts.now ?? Date.now;
    this.graceMs = opts.graceMs ?? WEEK_MS;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async load(): Promise<LoadedConfig> {
    const cache = this.readCache();
    const cachedVersion = this.verifyCached(cache)?.version;

    const urls = [...new Set([...this.opts.beaconUrls, ...(this.verifyCached(cache)?.beaconUrls ?? [])])];
    for (const url of urls) {
      const fresh = await this.fetchFrom(url, cache, cachedVersion);
      if (fresh) return { config: this.withSeedUrls(fresh), source: 'network' };
    }

    const cached = this.verifyCached(cache);
    if (cached) return { config: this.withSeedUrls(cached), source: 'cache' };
    return { config: defaultConfig(this.opts.beaconUrls, this.now()), source: 'default' };
  }

  private withSeedUrls(config: ClientConfig): ClientConfig {
    return { ...config, beaconUrls: [...new Set([...config.beaconUrls, ...this.opts.beaconUrls])] };
  }

  private async getJson(url: string, path: string): Promise<unknown> {
    const res = await this.fetchImpl(new URL(path, url), { signal: AbortSignal.timeout(this.timeoutMs), ...(this.opts.bypassCache ? { cache: 'no-cache' as const } : {}) });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json();
  }

  private async fetchKeys(url: string): Promise<Record<string, string>> {
    return (await this.getJson(url, '/v1/keys')) as Record<string, string>;
  }

  private ring(encoded: Record<string, string>): KeyRing {
    return Object.fromEntries(Object.entries(encoded).map(([kid, key]) => [kid, fromBase64Url(key)]));
  }

  private async fetchFrom(url: string, cache: CachedConfig | undefined, cachedVersion: number | undefined) {
    try {
      const signed = await this.getJson(url, '/v1/config');
      const embedded = this.opts.trustedKeys;
      let encodedKeys = cache?.keys;

      const check = (keys: KeyRing) => verifyConfig(signed, { keys, now: this.now(), graceMs: this.graceMs, cachedVersion });

      let result = embedded ? check(embedded) : encodedKeys ? check(this.ring(encodedKeys)) : undefined;
      if (!embedded && (!result || (!result.ok && (result.reason === 'unknown-kid' || result.reason === 'bad-signature')))) {
        // No pinned keys: trust the keys this beacon serves over HTTPS, so a rotation is picked up.
        encodedKeys = await this.fetchKeys(url);
        result = check(this.ring(encodedKeys));
      }
      if (!result?.ok) return undefined;

      this.writeCache({ signed, keys: embedded ? undefined : encodedKeys });
      return result.config;
    } catch {
      return undefined;
    }
  }

  private verifyCached(cache: CachedConfig | undefined): ClientConfig | undefined {
    if (!cache) return undefined;
    const keys = this.opts.trustedKeys ?? (cache.keys ? this.ring(cache.keys) : undefined);
    if (!keys) return undefined;
    const result = verifyConfig(cache.signed, { keys, now: this.now(), graceMs: this.graceMs });
    return result.ok ? result.config : undefined;
  }

  private readCache(): CachedConfig | undefined {
    try {
      const raw = this.opts.storage?.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as CachedConfig) : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(cache: CachedConfig) {
    try {
      this.opts.storage?.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Storage may be full or unavailable; the config still works for this session.
    }
  }
}

/** Parses build-time trusted keys: JSON `{ "<kid>": "<base64url public key>" }`. */
export function parseTrustedKeys(raw: string | undefined): KeyRing | undefined {
  if (!raw) return undefined;
  const entries = Object.entries(JSON.parse(raw) as Record<string, string>);
  return Object.fromEntries(entries.map(([kid, key]) => [kid, fromBase64Url(key)]));
}
