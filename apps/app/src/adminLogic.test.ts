import { describe, expect, it } from 'vitest';
import { SETTING_KEYS, buildChange, formFromView, isEmptyChange, serverErrors, withDefault, type SettingKey, type SettingsView } from './adminLogic';

const view = (overrides: Partial<Record<SettingKey, object>> = {}, authConfigured = false): SettingsView => ({
  authConfigured,
  settings: {
    maxRoomSize: { source: 'env', value: 10, default: 10 },
    warnRoomSize: { source: 'env', value: 6, default: 6 },
    minClientVersion: { source: 'env', value: '0.0.0', default: '0.0.0' },
    announcement: { source: 'env', value: '', default: '' },
    roomCreation: { source: 'env', value: 'anyone', default: 'anyone' },
    defaultRoomAccess: { source: 'env', value: 'anyone', default: 'anyone' },
    stunUrls: { source: 'env', value: ['stun:a:1'], default: ['stun:a:1'] },
    turnUrls: { source: 'env', value: [], default: [] },
    turnSecret: { source: 'env', isSet: false, defaultIsSet: false },
    relayVideoKbps: { source: 'env', value: null, default: null },
    relayVideoScale: { source: 'env', value: null, default: null },
    relayVideoFps: { source: 'env', value: null, default: null },
    giphyApiKey: { source: 'env', isSet: false, defaultIsSet: false },
    ...overrides,
  } as SettingsView['settings'],
});

const none = new Set<SettingKey>();
const VERSION = '1.4.0';

describe('formFromView', () => {
  it('shows each setting as text, one address per line, and leaves secrets empty', () => {
    const v = view({ stunUrls: { source: 'saved', value: ['stun:a:1', 'stun:b:2'], default: [] }, relayVideoKbps: { source: 'saved', value: 800, default: null }, turnSecret: { source: 'saved', isSet: true, defaultIsSet: false } });
    expect(formFromView(v)).toMatchObject({ maxRoomSize: '10', stunUrls: 'stun:a:1\nstun:b:2', relayVideoKbps: '800', relayVideoScale: '', turnSecret: '', clearTurnSecret: false });
    expect(formFromView(v, 'default')).toMatchObject({ stunUrls: '', relayVideoKbps: '' });
  });

  it('covers every setting the server has', () => {
    expect(Object.keys(view().settings).sort()).toEqual([...SETTING_KEYS].sort());
  });
});

describe('buildChange', () => {
  it('sends nothing when nothing was edited', () => {
    const v = view();
    const change = buildChange(formFromView(v), v, none, VERSION);
    expect(change).toEqual({ ok: true, set: {}, reset: [] });
    expect(isEmptyChange(change)).toBe(true);
  });

  it('sends only what was edited, as the right types', () => {
    const v = view();
    const form = { ...formFromView(v), maxRoomSize: '8', announcement: '  Back at 5  ', stunUrls: 'stun:a:1, stun:b:2', relayVideoKbps: '900', relayVideoScale: '1.5', roomCreation: 'anyone' as const };
    expect(buildChange(form, v, none, VERSION)).toEqual({
      ok: true,
      set: { maxRoomSize: 8, announcement: 'Back at 5', stunUrls: ['stun:a:1', 'stun:b:2'], relayVideoKbps: 900, relayVideoScale: 1.5 },
      reset: [],
    });
  });

  it('turns an emptied optional number back into "use the built-in value"', () => {
    const v = view({ relayVideoKbps: { source: 'saved', value: 900, default: null } });
    expect(buildChange({ ...formFromView(v), relayVideoKbps: '' }, v, none, VERSION)).toEqual({ ok: true, set: { relayVideoKbps: null }, reset: [] });
  });

  it('explains values that are not numbers or versions, field by field', () => {
    const v = view();
    const result = buildChange({ ...formFromView(v), maxRoomSize: 'lots', relayVideoFps: '2.5', relayVideoScale: 'big', minClientVersion: 'new' }, v, none, VERSION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['maxRoomSize', 'minClientVersion', 'relayVideoFps', 'relayVideoScale']);
  });

  it('refuses a minimum version above this app, which would tell everyone to update', () => {
    const v = view();
    const result = buildChange({ ...formFromView(v), minClientVersion: '2.0.0' }, v, none, VERSION);
    expect(result).toMatchObject({ ok: false, errors: { minClientVersion: expect.stringContaining('1.4.0') } });
    expect(buildChange({ ...formFromView(v), minClientVersion: '1.4.0' }, v, none, VERSION)).toMatchObject({ ok: true, set: { minClientVersion: '1.4.0' } });
  });

  it('sends a new secret only when one was typed, and clears it only on request', () => {
    const v = view({ turnSecret: { source: 'saved', isSet: true, defaultIsSet: false } });
    expect(buildChange(formFromView(v), v, none, VERSION)).toMatchObject({ set: {} });
    expect(buildChange({ ...formFromView(v), turnSecret: ' new-secret ' }, v, none, VERSION)).toMatchObject({ set: { turnSecret: 'new-secret' } });
    expect(buildChange({ ...formFromView(v), clearTurnSecret: true }, v, none, VERSION)).toMatchObject({ set: { turnSecret: '' } });
    // Clearing something that is not set changes nothing.
    const unset = view();
    expect(buildChange({ ...formFromView(unset), clearGiphyApiKey: true }, unset, none, VERSION)).toMatchObject({ set: {} });
  });

  it('resets saved settings, ignoring edits to them, and ignores resets of settings that were never changed', () => {
    const v = view({ maxRoomSize: { source: 'saved', value: 4, default: 10 } });
    const form = { ...formFromView(v), maxRoomSize: '7', warnRoomSize: '5' };
    expect(buildChange(form, v, new Set<SettingKey>(['maxRoomSize', 'announcement']), VERSION)).toEqual({ ok: true, set: { warnRoomSize: 5 }, reset: ['maxRoomSize'] });
  });
});

describe('withDefault', () => {
  it('puts one setting back to its default and leaves the rest of the edits', () => {
    const v = view({ maxRoomSize: { source: 'saved', value: 4, default: 10 }, turnSecret: { source: 'saved', isSet: true, defaultIsSet: false } });
    const form = { ...formFromView(v), warnRoomSize: '3', turnSecret: 'typed', clearTurnSecret: true };
    expect(withDefault(form, v, 'maxRoomSize')).toMatchObject({ maxRoomSize: '10', warnRoomSize: '3' });
    expect(withDefault(form, v, 'turnSecret')).toMatchObject({ turnSecret: '', clearTurnSecret: false, warnRoomSize: '3' });
  });
});

describe('serverErrors', () => {
  it('maps the server\'s reasons to fields, with anything else as a general message', () => {
    expect(serverErrors({ error: 'Some settings were not accepted.', errors: { maxRoomSize: 'Use 2 to 100.', _: 'Disk full.' } })).toEqual({ fields: { maxRoomSize: 'Use 2 to 100.' }, general: 'Disk full.' });
    expect(serverErrors({ error: 'Invalid request.' })).toEqual({ fields: {}, general: 'Invalid request.' });
    expect(serverErrors(null)).toEqual({ fields: {}, general: undefined });
  });
});
