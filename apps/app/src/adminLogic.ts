import { compareVersions } from '@orvo/protocol';

/** The settings the server lets an operator change; the names match the server's. */
export const SETTING_KEYS = [
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
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Settings whose value the server never sends back; the page only knows whether one is set. */
export const SECRET_KEYS: readonly SettingKey[] = ['turnSecret', 'giphyApiKey'];

export interface SettingView {
  /** Where the value in force comes from: the server's own settings (`env`) or a change saved in this page. */
  source: 'env' | 'saved';
  value?: unknown;
  default?: unknown;
  /** Secrets only. */
  isSet?: boolean;
  defaultIsSet?: boolean;
}

export interface SettingsView {
  settings: Record<SettingKey, SettingView>;
  /** Whether the server has a sign-in provider; without one, requiring sign-in cannot be chosen. */
  authConfigured: boolean;
}

/** What the form edits: text as typed, so a half-typed number can be shown and explained. */
export interface FormState {
  maxRoomSize: string;
  warnRoomSize: string;
  minClientVersion: string;
  announcement: string;
  roomCreation: 'anyone' | 'signed-in';
  defaultRoomAccess: 'anyone' | 'signed-in';
  /** One address per line. */
  stunUrls: string;
  turnUrls: string;
  /** A new secret; empty leaves the saved one alone. */
  turnSecret: string;
  clearTurnSecret: boolean;
  relayVideoKbps: string;
  relayVideoScale: string;
  relayVideoFps: string;
  giphyApiKey: string;
  clearGiphyApiKey: boolean;
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const lines = (v: unknown): string => (Array.isArray(v) ? v.join('\n') : '');

/** The form for the values in force, or for each setting's default (what "Reset to default" shows). */
export function formFromView(view: SettingsView, which: 'value' | 'default' = 'value'): FormState {
  const s = view.settings;
  const v = (key: SettingKey) => s[key][which];
  return {
    maxRoomSize: text(v('maxRoomSize')),
    warnRoomSize: text(v('warnRoomSize')),
    minClientVersion: text(v('minClientVersion')),
    announcement: text(v('announcement')),
    roomCreation: v('roomCreation') === 'signed-in' ? 'signed-in' : 'anyone',
    defaultRoomAccess: v('defaultRoomAccess') === 'signed-in' ? 'signed-in' : 'anyone',
    stunUrls: lines(v('stunUrls')),
    turnUrls: lines(v('turnUrls')),
    turnSecret: '',
    clearTurnSecret: false,
    relayVideoKbps: text(v('relayVideoKbps')),
    relayVideoScale: text(v('relayVideoScale')),
    relayVideoFps: text(v('relayVideoFps')),
    giphyApiKey: '',
    clearGiphyApiKey: false,
  };
}

/** The form with one setting put back to what the server's own settings say. */
export function withDefault(form: FormState, view: SettingsView, key: SettingKey): FormState {
  const defaults = formFromView(view, 'default');
  if (key === 'turnSecret') return { ...form, turnSecret: '', clearTurnSecret: false };
  if (key === 'giphyApiKey') return { ...form, giphyApiKey: '', clearGiphyApiKey: false };
  return { ...form, [key]: defaults[key] };
}

const splitLines = (value: string): string[] => value.split(/[\n,]/).map((u) => u.trim()).filter(Boolean);

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const wholeNumber = (value: string, empty: 'null' | 'error'): Parsed => {
  const t = value.trim();
  if (t === '' && empty === 'null') return { ok: true, value: null };
  return /^\d+$/.test(t) ? { ok: true, value: Number(t) } : { ok: false, error: empty === 'null' ? 'Enter a whole number, or leave it empty.' : 'Enter a whole number.' };
};

const decimal = (value: string): Parsed => {
  const t = value.trim();
  if (t === '') return { ok: true, value: null };
  return /^\d+(\.\d+)?$/.test(t) ? { ok: true, value: Number(t) } : { ok: false, error: 'Enter a number, or leave it empty.' };
};

/** The value a form field means for a (non-secret) setting. */
function parseField(form: FormState, key: SettingKey): Parsed {
  switch (key) {
    case 'maxRoomSize':
    case 'warnRoomSize':
      return wholeNumber(form[key], 'error');
    case 'relayVideoKbps':
    case 'relayVideoFps':
      return wholeNumber(form[key], 'null');
    case 'relayVideoScale':
      return decimal(form.relayVideoScale);
    case 'minClientVersion':
      return /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(form.minClientVersion.trim()) ? { ok: true, value: form.minClientVersion.trim() } : { ok: false, error: 'Use a version such as 1.2.0.' };
    case 'announcement':
      return { ok: true, value: form.announcement.trim() };
    case 'roomCreation':
    case 'defaultRoomAccess':
      return { ok: true, value: form[key] };
    case 'stunUrls':
    case 'turnUrls':
      return { ok: true, value: splitLines(form[key]) };
    default:
      return { ok: false, error: 'Not a setting.' };
  }
}

export type Change = { ok: true; set: Record<string, unknown>; reset: SettingKey[] } | { ok: false; errors: Partial<Record<SettingKey, string>> };

/**
 * What to send the server for the edits made: the values that differ from what is in force, plus the settings put back
 * to their defaults. `clientVersion` is this app's own version, so a minimum version nobody on it could meet is refused
 * here before it locks everyone out.
 */
export function buildChange(form: FormState, view: SettingsView, resets: ReadonlySet<SettingKey>, clientVersion: string): Change {
  const set: Record<string, unknown> = {};
  const reset: SettingKey[] = [];
  const errors: Partial<Record<SettingKey, string>> = {};

  for (const key of SETTING_KEYS) {
    const current = view.settings[key];
    if (resets.has(key)) {
      if (current.source === 'saved') reset.push(key);
      continue;
    }
    if (SECRET_KEYS.includes(key)) {
      const [typed, clear] = key === 'turnSecret' ? [form.turnSecret, form.clearTurnSecret] : [form.giphyApiKey, form.clearGiphyApiKey];
      if (typed.trim()) set[key] = typed.trim();
      else if (clear && current.isSet) set[key] = '';
      continue;
    }
    const parsed = parseField(form, key);
    if (!parsed.ok) {
      errors[key] = parsed.error;
      continue;
    }
    if (JSON.stringify(parsed.value) === JSON.stringify(current.value)) continue;
    if (key === 'minClientVersion' && compareVersions(parsed.value as string, clientVersion) > 0) {
      errors[key] = `This app is version ${clientVersion}. A higher minimum would tell everyone using it to update.`;
      continue;
    }
    set[key] = parsed.value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, set, reset };
}

/** Whether a change would do anything. */
export const isEmptyChange = (change: Change): boolean => change.ok && Object.keys(change.set).length === 0 && change.reset.length === 0;

/** Server explanations keyed by setting, from a refused save; anything else is shown as one general message. */
export function serverErrors(body: unknown): { fields: Partial<Record<SettingKey, string>>; general?: string } {
  const errors = (body as { errors?: Record<string, unknown> } | null)?.errors;
  const fields: Partial<Record<SettingKey, string>> = {};
  const general: string[] = [];
  for (const [key, message] of Object.entries(errors ?? {})) {
    if (typeof message !== 'string') continue;
    if ((SETTING_KEYS as readonly string[]).includes(key)) fields[key as SettingKey] = message;
    else general.push(message);
  }
  const fallback = (body as { error?: unknown } | null)?.error;
  return { fields, general: general.join(' ') || (Object.keys(fields).length === 0 && typeof fallback === 'string' ? fallback : undefined) };
}
