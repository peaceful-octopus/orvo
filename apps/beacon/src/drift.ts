import type { Redis } from 'ioredis';
import { createHmac } from 'node:crypto';
import { SETTING_KEYS, type SettingKey, type Settings } from './settings';

/**
 * Beacons that share Redis share the settings saved in the admin page, but each starts from its own environment for the
 * settings nobody has saved. They agree as long as their environments agree. Each beacon therefore reports a fingerprint
 * of the environment's value of every setting, and the beacons compare them, so an environment that differs is noticed
 * and not served silently.
 */
export interface DriftEntry {
  /** When the beacon last reported, in milliseconds. */
  seen: number;
  /** A keyed hash of the environment's value for each setting. It is keyed with the signing secret, so a secret cannot be guessed from it. */
  settings: Partial<Record<SettingKey, string>>;
}

export interface Drift {
  /** The settings that differ between beacons and have no saved value, so each beacon serves its own. */
  settings: SettingKey[];
  /** For each beacon that differs from the most common value, the settings it differs on. */
  differing: Record<string, SettingKey[]>;
}

export interface BeaconRegistry {
  announce(id: string, entry: DriftEntry): Promise<void>;
  entries(): Promise<Record<string, DriftEntry>>;
  remove(id: string): Promise<void>;
}

export function redisRegistry(redis: Redis, key = 'orvo:beacons'): BeaconRegistry {
  return {
    async announce(id, entry) {
      await redis.hset(key, id, JSON.stringify(entry));
    },
    async entries() {
      const fields = await redis.hgetall(key);
      const entries: Record<string, DriftEntry> = {};
      for (const [id, text] of Object.entries(fields)) {
        try {
          const parsed = JSON.parse(text) as DriftEntry;
          if (typeof parsed.seen === 'number' && typeof parsed.settings === 'object' && parsed.settings !== null) entries[id] = parsed;
        } catch {
          // a damaged entry is ignored, and replaced when that beacon next reports
        }
      }
      return entries;
    },
    async remove(id) {
      await redis.hdel(key, id);
    },
  };
}

export function fingerprints(defaults: Settings, secret: Uint8Array): DriftEntry['settings'] {
  const result: DriftEntry['settings'] = {};
  for (const key of SETTING_KEYS) {
    result[key] = createHmac('sha256', secret).update(JSON.stringify(defaults[key] ?? null)).digest('hex').slice(0, 12);
  }
  return result;
}

/**
 * Where the live beacons disagree about a setting that has no saved value. A setting with a saved value is left out,
 * because the saved value overrides every beacon's environment. Beacons that have not reported for `staleMs` are gone.
 */
export function findDrift(entries: Record<string, DriftEntry>, now: number, staleMs: number, isSaved: (key: SettingKey) => boolean): Drift | undefined {
  const live = Object.entries(entries).filter(([, entry]) => now - entry.seen <= staleMs);
  if (live.length < 2) return undefined;
  const settings: SettingKey[] = [];
  const differing: Record<string, SettingKey[]> = {};
  for (const key of SETTING_KEYS) {
    if (isSaved(key)) continue;
    const counts = new Map<string, number>();
    for (const [, entry] of live) {
      const fingerprint = entry.settings[key] ?? '';
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
    }
    if (counts.size < 2) continue;
    settings.push(key);
    // The most common value is taken as the fleet's; a tie goes to the smaller fingerprint so every beacon names the same ones.
    const common = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    for (const [id, entry] of live) {
      if ((entry.settings[key] ?? '') !== common) (differing[id] ??= []).push(key);
    }
  }
  return settings.length > 0 ? { settings, differing } : undefined;
}

export interface DriftMonitorOptions {
  registry: BeaconRegistry;
  /** Names this beacon among the others. */
  id: string;
  /** The values this beacon's environment gives. */
  defaults: Settings;
  secret: Uint8Array;
  isSaved: (key: SettingKey) => boolean;
  intervalMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}

/** Reports this beacon's environment now and then, compares it with the others, and says when they stop or start to agree. */
export class DriftMonitor {
  private entries: Record<string, DriftEntry> = {};
  private lastReported: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly entry: DriftEntry['settings'];
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;

  constructor(private readonly opts: DriftMonitorOptions) {
    this.entry = fingerprints(opts.defaults, opts.secret);
    this.intervalMs = opts.intervalMs ?? 15_000;
    this.now = opts.now ?? Date.now;
    this.warn = opts.warn ?? ((m) => console.warn(m));
  }

  /** What differs now, or `undefined` when the beacons agree (or this is the only one). Settings saved since the last check count at once. */
  current(): Drift | undefined {
    return findDrift(this.entries, this.now(), this.intervalMs * 3, this.opts.isSaved);
  }

  async start(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.opts.registry.remove(this.opts.id).catch(() => {});
  }

  async check(): Promise<void> {
    const staleMs = this.intervalMs * 3;
    const now = this.now();
    try {
      await this.opts.registry.announce(this.opts.id, { seen: now, settings: this.entry });
      const entries = await this.opts.registry.entries();
      // Entries from beacons that stopped without saying so are cleared once they are long past stale.
      for (const [id, entry] of Object.entries(entries)) {
        if (now - entry.seen > staleMs * 10) await this.opts.registry.remove(id).catch(() => {});
      }
      this.entries = entries;
    } catch {
      return; // Redis is unreachable; keep what was last known
    }
    const drift = this.current();
    const signature = JSON.stringify(drift ?? null);
    if (signature === this.lastReported) return;
    const first = this.lastReported === undefined;
    this.lastReported = signature;
    if (drift) this.warn(describeDrift(drift));
    else if (!first) this.warn('The beacons start from the same environment values again.');
  }
}

export function describeDrift(drift: Drift): string {
  const who = Object.entries(drift.differing)
    .map(([id, keys]) => `${id} differs on ${keys.join(', ')}`)
    .join('; ');
  return `Beacons start from different environment values for: ${drift.settings.join(', ')} (${who}). Each serves its own value until one is saved in the admin page. Make their environments match, or save the value there.`;
}
