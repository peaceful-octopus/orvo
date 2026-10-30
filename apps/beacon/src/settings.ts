import { MAX_ROOM_SIZE, WARN_ROOM_SIZE } from '@orvo/protocol';
import { createHash } from 'node:crypto';
import type { LiveSettings } from './app';
import { authSettingsFromEnv } from './auth-env';
import { relayVideoSettingsFromEnv, relayVideoTier } from './limits-env';
import { fileSettings, type SettingsBackend } from './settings-backend';

/** What an operator can change while the server runs. Everything else stays an environment setting. */
export interface Settings {
  maxRoomSize: number;
  warnRoomSize: number;
  minClientVersion: string;
  /** Shown to everyone as a banner; empty means none. */
  announcement: string;
  roomCreation: 'anyone' | 'signed-in';
  defaultRoomAccess: 'anyone' | 'signed-in';
  stunUrls: string[];
  turnUrls: string[];
  turnSecret: string;
  /** Video sent through the relay; `null` keeps the built-in default for that part. */
  relayVideoKbps: number | null;
  relayVideoScale: number | null;
  relayVideoFps: number | null;
  giphyApiKey: string;
}

export type SettingKey = keyof Settings;

export const SETTING_KEYS: readonly SettingKey[] = [
  'maxRoomSize',
  'warnRoomSize',
  'minClientVersion',
  'announcement',
  'roomCreation',
  'defaultRoomAccess',
  'stunUrls',
  'turnUrls',
  'turnSecret',
  'relayVideoKbps',
  'relayVideoScale',
  'relayVideoFps',
  'giphyApiKey',
];

/** Values the admin page never sends back to the browser. */
export const SECRET_KEYS: readonly SettingKey[] = ['turnSecret', 'giphyApiKey'];

export type Errors = Record<string, string>;

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
const MAX_NAME_LENGTH = 200;
/** How often the saved settings are read again, in case a change notice was missed. */
const RELOAD_MS = 30_000;

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const urlList = (schemes: string[], what: string) => (v: unknown): string | undefined => {
  if (!Array.isArray(v) || v.length > 8 || v.some((u) => typeof u !== 'string')) return `Give up to 8 ${what} addresses.`;
  const bad = (v as string[]).find((u) => !new RegExp(`^(${schemes.join('|')}):[^\\s,]+$`).test(u.trim()));
  return bad === undefined ? undefined : `"${bad}" is not a ${what} address; it should look like ${schemes[0]}:host:3478.`;
};

/** One check per setting; each returns an explanation when the value is not acceptable. */
const CHECKS: Record<SettingKey, (v: unknown) => string | undefined> = {
  maxRoomSize: (v) => (isInt(v, 2, 100) ? undefined : 'Use a whole number from 2 to 100.'),
  warnRoomSize: (v) => (isInt(v, 1, 100) ? undefined : 'Use a whole number from 1 to 100.'),
  minClientVersion: (v) => (typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) ? undefined : 'Use a version such as 1.2.0.'),
  announcement: (v) => (typeof v === 'string' && v.length <= 500 ? undefined : 'Use at most 500 characters.'),
  roomCreation: (v) => (v === 'anyone' || v === 'signed-in' ? undefined : 'Choose who may start rooms.'),
  defaultRoomAccess: (v) => (v === 'anyone' || v === 'signed-in' ? undefined : 'Choose who may join new rooms.'),
  stunUrls: urlList(['stun', 'stuns'], 'STUN'),
  turnUrls: urlList(['turn', 'turns'], 'TURN'),
  turnSecret: (v) => (typeof v === 'string' && v.length <= MAX_NAME_LENGTH ? undefined : 'Use at most 200 characters.'),
  relayVideoKbps: (v) => (v === null || isInt(v, 1, 100_000) ? undefined : 'Use a whole number of kilobits a second, or leave it empty.'),
  relayVideoScale: (v) => (v === null || isNum(v, 1, 8) ? undefined : 'Use a number from 1 to 8, or leave it empty.'),
  relayVideoFps: (v) => (v === null || isInt(v, 1, 60) ? undefined : 'Use a whole number from 1 to 60, or leave it empty.'),
  giphyApiKey: (v) => (typeof v === 'string' && v.length <= MAX_NAME_LENGTH ? undefined : 'Use at most 200 characters.'),
};

/** Cleans a value the way it will be stored: trimmed text, no empty addresses. */
function normalize(key: SettingKey, value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if ((key === 'stunUrls' || key === 'turnUrls') && Array.isArray(value)) {
    return value.map((u) => (typeof u === 'string' ? u.trim() : u)).filter((u) => u !== '');
  }
  return value;
}

/** Rules that involve several settings at once, which the server also enforces when it starts. */
export function validateTogether(s: Settings, ctx: { authConfigured: boolean }): Errors {
  const errors: Errors = {};
  if (s.warnRoomSize > s.maxRoomSize) errors.warnRoomSize = 'The warning size cannot be above the room size.';
  if (!ctx.authConfigured) {
    const needs = 'Requiring sign-in needs a sign-in provider (OIDC_ISSUER and OIDC_CLIENT_ID in the server settings).';
    if (s.roomCreation === 'signed-in') errors.roomCreation = needs;
    if (s.defaultRoomAccess === 'signed-in') errors.defaultRoomAccess = needs;
  }
  if (s.turnUrls.length > 0 && !s.turnSecret) errors.turnSecret = 'A relay needs its shared secret.';
  if (s.turnUrls.length === 0 && s.turnSecret) errors.turnUrls = 'A relay secret needs a relay address.';
  return errors;
}

const splitList = (value: string | undefined): string[] => (value ?? '').split(',').map((u) => u.trim()).filter(Boolean);

/**
 * The settings the server starts with, from the environment (the same variables as before). `rules` can pass the
 * already-read ROOM_CREATION and DEFAULT_ROOM_ACCESS so the sign-in settings are not parsed twice.
 */
export function settingsFromEnv(
  env: Record<string, string | undefined>,
  rules?: { roomCreation: 'anyone' | 'signed-in'; defaultRoomAccess: 'anyone' | 'signed-in' },
): Settings {
  const { roomCreation, defaultRoomAccess } = rules ?? authSettingsFromEnv(env);
  const relay = relayVideoSettingsFromEnv(env);
  return {
    maxRoomSize: env.MAX_ROOM_SIZE ? Number(env.MAX_ROOM_SIZE) : MAX_ROOM_SIZE,
    warnRoomSize: env.WARN_ROOM_SIZE ? Number(env.WARN_ROOM_SIZE) : WARN_ROOM_SIZE,
    minClientVersion: env.MIN_CLIENT_VERSION || '0.0.0',
    announcement: env.ANNOUNCEMENT ?? '',
    roomCreation,
    defaultRoomAccess,
    stunUrls: env.STUN_URLS === undefined ? [DEFAULT_STUN] : splitList(env.STUN_URLS),
    turnUrls: splitList(env.TURN_URLS),
    turnSecret: env.TURN_SECRET ?? '',
    relayVideoKbps: relay.kbps,
    relayVideoScale: relay.scale,
    relayVideoFps: relay.fps,
    giphyApiKey: env.GIPHY_API_KEY ?? '',
  };
}

export interface SettingsStoreOptions {
  /** What each setting is when the operator has not changed it: the environment. */
  defaults: Settings;
  /** Where changes are kept between restarts, and shared with other servers. Without it they last until the process ends. */
  backend?: SettingsBackend;
  /** A file in the data directory; shorthand for `backend: fileSettings(file)`. */
  file?: string;
  /** Whether a sign-in provider is configured; the sign-in rules depend on it. */
  authConfigured: boolean;
  /** The announcement's id when it is the one from the environment (clients hide an announcement they dismissed by id). */
  defaultAnnouncementId?: string;
  warn?: (message: string) => void;
}

export type UpdateResult = { ok: true } | { ok: false; errors: Errors };

/**
 * The settings in force: the environment's values with the operator's saved changes laid over them. Saved values win,
 * and resetting one brings the environment's value back.
 */
export class SettingsStore {
  private saved: Partial<Settings> = {};
  private readonly warn: (message: string) => void;
  private readonly backend: SettingsBackend | undefined;
  private stop: (() => void) | undefined;

  /** Reads whatever is saved, then follows changes other servers save. A store made with `new` starts from the environment only. */
  static async open(opts: SettingsStoreOptions): Promise<SettingsStore> {
    const store = new SettingsStore(opts);
    await store.reload();
    store.follow();
    return store;
  }

  constructor(private readonly opts: SettingsStoreOptions) {
    this.warn = opts.warn ?? ((m) => console.warn(m));
    this.backend = opts.backend ?? (opts.file ? fileSettings(opts.file) : undefined);
  }

  /** Stops following other servers' changes. */
  close(): void {
    this.stop?.();
    this.stop = undefined;
  }

  /**
   * Takes the saved settings from the backend. When it cannot be reached the settings stay as they are (the
   * environment's, at start), and the next change notice or the periodic check tries again.
   */
  async reload(): Promise<void> {
    if (!this.backend) return;
    try {
      this.saved = await this.fetch();
    } catch (err) {
      this.warn(`Could not read the saved settings from ${this.backend.where}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The saved settings as the backend holds them now. Throws when the backend cannot be read. */
  private async fetch(): Promise<Partial<Settings>> {
    if (!this.backend) return this.saved;
    const raw = await this.backend.load();
    return raw === undefined ? {} : this.parse(raw, this.backend.where);
  }

  private follow(): void {
    if (!this.backend?.watch) return;
    const stopWatching = this.backend.watch(() => void this.reload());
    // A notice can be missed while the connection is down, so the settings are also read again now and then.
    const timer = setInterval(() => void this.reload(), RELOAD_MS);
    timer.unref();
    this.stop = () => {
      stopWatching();
      clearInterval(timer);
    };
  }

  defaults(): Settings {
    return this.opts.defaults;
  }

  authConfigured(): boolean {
    return this.opts.authConfigured;
  }

  effective(): Settings {
    return this.merge(this.saved);
  }

  /** The environment's values under `saved`. An unchanged warning size follows the room size down, so lowering one needs no edit of the other. */
  private merge(saved: Partial<Settings>): Settings {
    const merged = { ...this.opts.defaults, ...saved };
    if (!('warnRoomSize' in saved)) merged.warnRoomSize = Math.min(merged.warnRoomSize, merged.maxRoomSize);
    return merged;
  }

  isSaved(key: SettingKey): boolean {
    return key in this.saved;
  }

  /** Applies `set` and `reset` together; nothing changes unless all of it is acceptable. */
  async update(change: { set?: Record<string, unknown>; reset?: string[] }): Promise<UpdateResult> {
    const errors: Errors = {};
    // Start from what is saved now, not from this beacon's last view, so a change another beacon saved is not undone.
    let current: Partial<Settings>;
    try {
      current = await this.fetch();
    } catch (err) {
      return { ok: false, errors: { _: `The saved settings could not be read (${err instanceof Error ? err.message : String(err)}).` } };
    }
    const next: Partial<Settings> = { ...current };
    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    for (const [key, raw] of Object.entries(change.set ?? {})) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) {
        errors[key] = 'Not a setting.';
        continue;
      }
      const value = normalize(key as SettingKey, raw);
      const problem = CHECKS[key as SettingKey](value);
      if (problem) errors[key] = problem;
      else (next as Record<string, unknown>)[key] = set[key] = value;
    }
    for (const key of change.reset ?? []) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) errors[key] = 'Not a setting.';
      else {
        delete next[key as SettingKey];
        remove.push(key);
      }
    }
    if (Object.keys(errors).length === 0) Object.assign(errors, validateTogether(this.merge(next), { authConfigured: this.opts.authConfigured }));
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    try {
      // Only the settings this change names are written, so another operator's change to a different one stays.
      await this.backend?.save({ set, remove });
    } catch (err) {
      return { ok: false, errors: { _: `The change could not be saved (${err instanceof Error ? err.message : String(err)}).` } };
    }
    this.saved = next;
    return { ok: true };
  }

  /** The settings in the form the beacon reads them. */
  live(): LiveSettings {
    const s = this.effective();
    const pool = s.turnUrls.length > 0 && s.turnSecret ? { urls: s.turnUrls, secret: s.turnSecret } : undefined;
    return {
      limits: {
        maxRoomSize: s.maxRoomSize,
        warnRoomSize: s.warnRoomSize,
        relayVideoTier: relayVideoTier({ kbps: s.relayVideoKbps, scale: s.relayVideoScale, fps: s.relayVideoFps }),
      },
      stunUrls: s.stunUrls,
      turn: { full: pool },
      // A personal server has no entitlement service, so a relay, when there is one, is for every room.
      defaultTier: pool ? 'full' : undefined,
      minClientVersion: s.minClientVersion,
      announcement: s.announcement ? { id: this.announcementId(s.announcement), text: s.announcement } : undefined,
      integrations: { giphyApiKey: s.giphyApiKey || undefined },
      roomCreation: s.roomCreation,
      defaultRoomAccess: s.defaultRoomAccess,
    };
  }

  /** A changed announcement gets a new id, so people who dismissed the old one see the new one. */
  private announcementId(text: string): string {
    if (text === this.opts.defaults.announcement && this.opts.defaultAnnouncementId) return this.opts.defaultAnnouncementId;
    return `a-${createHash('sha1').update(text).digest('hex').slice(0, 8)}`;
  }

  private parse(parsed: unknown, where: string): Partial<Settings> {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.warn(`Ignoring ${where}, which could not be read as settings.`);
      return {};
    }
    const kept: Partial<Settings> = {};
    for (const key of SETTING_KEYS) {
      if (!(key in parsed)) continue;
      const value = normalize(key, (parsed as Record<string, unknown>)[key]);
      const problem = CHECKS[key](value);
      if (problem) this.warn(`Ignoring the saved ${key} in ${where}: ${problem}`);
      else (kept as Record<string, unknown>)[key] = value;
    }
    // Saved values that no longer fit together (for example after sign-in was removed from the server's settings) would
    // stop the server working, so the environment's values are used instead.
    const together = validateTogether(this.merge(kept), { authConfigured: this.opts.authConfigured });
    if (Object.keys(together).length > 0) {
      this.warn(`Ignoring all saved settings in ${where}: ${Object.values(together).join(' ')}`);
      return {};
    }
    return kept;
  }
}
