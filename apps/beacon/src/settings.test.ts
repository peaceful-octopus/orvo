import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore, settingsFromEnv, validateTogether, type Settings } from './settings';

const defaults = (extra: Partial<Settings> = {}): Settings => ({ ...settingsFromEnv({}, { roomCreation: 'anyone', defaultRoomAccess: 'anyone' }), ...extra });

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-settings-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('settingsFromEnv', () => {
  it('uses the built-in defaults with an empty environment', () => {
    expect(defaults()).toMatchObject({
      maxRoomSize: 10,
      warnRoomSize: 6,
      minClientVersion: '0.0.0',
      announcement: '',
      stunUrls: ['stun:stun.l.google.com:19302'],
      turnUrls: [],
      turnSecret: '',
      relayVideoKbps: null,
      giphyApiKey: '',
    });
  });

  it('reads each environment variable', () => {
    const s = settingsFromEnv(
      {
        MAX_ROOM_SIZE: '8',
        WARN_ROOM_SIZE: '5',
        MIN_CLIENT_VERSION: '1.2.0',
        ANNOUNCEMENT: 'Hello',
        STUN_URLS: 'stun:a:1, stun:b:2',
        TURN_URLS: 'turn:t:3478',
        TURN_SECRET: 'abc',
        RELAY_VIDEO_KBPS: '900',
        RELAY_VIDEO_FPS: '30',
        GIPHY_API_KEY: 'key',
      },
      { roomCreation: 'signed-in', defaultRoomAccess: 'anyone' },
    );
    expect(s).toMatchObject({
      maxRoomSize: 8,
      warnRoomSize: 5,
      minClientVersion: '1.2.0',
      announcement: 'Hello',
      stunUrls: ['stun:a:1', 'stun:b:2'],
      turnUrls: ['turn:t:3478'],
      turnSecret: 'abc',
      relayVideoKbps: 900,
      relayVideoScale: null,
      relayVideoFps: 30,
      giphyApiKey: 'key',
      roomCreation: 'signed-in',
    });
  });
});

describe('SettingsStore', () => {
  it('lays saved values over the environment and brings the environment back on reset', async () => {
    const store = new SettingsStore({ defaults: defaults(), authConfigured: false });
    expect(await store.update({ set: { maxRoomSize: 4 } })).toEqual({ ok: true });
    expect(store.effective().maxRoomSize).toBe(4);
    expect(store.isSaved('maxRoomSize')).toBe(true);
    expect(store.isSaved('warnRoomSize')).toBe(false);

    expect(await store.update({ reset: ['maxRoomSize'] })).toEqual({ ok: true });
    expect(store.effective().maxRoomSize).toBe(10);
    expect(store.isSaved('maxRoomSize')).toBe(false);
  });

  it('trims text and drops empty addresses', async () => {
    const store = new SettingsStore({ defaults: defaults(), authConfigured: false });
    await store.update({ set: { announcement: '  Back at 5  ', stunUrls: [' stun:a:1 ', ''] } });
    expect(store.effective()).toMatchObject({ announcement: 'Back at 5', stunUrls: ['stun:a:1'] });
  });

  it('refuses values that make no sense, explaining each, and changes nothing', async () => {
    const store = new SettingsStore({ defaults: defaults(), authConfigured: false });
    const result = await store.update({
      set: { maxRoomSize: 1, minClientVersion: 'new', stunUrls: ['http://x'], relayVideoScale: 0.5, nope: 1 },
      reset: ['alsoNope'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['alsoNope', 'maxRoomSize', 'minClientVersion', 'nope', 'relayVideoScale', 'stunUrls']);
    expect(store.effective()).toEqual(defaults());
  });

  it('checks settings against each other', async () => {
    const store = new SettingsStore({ defaults: defaults(), authConfigured: false });
    expect(await store.update({ set: { warnRoomSize: 12 } })).toMatchObject({ ok: false, errors: { warnRoomSize: expect.any(String) } });
    expect(await store.update({ set: { turnUrls: ['turn:t:3478'] } })).toMatchObject({ ok: false, errors: { turnSecret: expect.any(String) } });
    expect(await store.update({ set: { turnSecret: 'abc' } })).toMatchObject({ ok: false, errors: { turnUrls: expect.any(String) } });
    expect(await store.update({ set: { turnUrls: ['turn:t:3478'], turnSecret: 'abc' } })).toEqual({ ok: true });
    expect(await store.update({ set: { warnRoomSize: 6, maxRoomSize: 4 } })).toMatchObject({ ok: false, errors: { warnRoomSize: expect.any(String) } }); // a warning size chosen on purpose stays
    expect(await store.update({ set: { maxRoomSize: 4, warnRoomSize: 3 } })).toEqual({ ok: true });
  });

  it('lets the warning size follow the room size down until it is set on purpose', async () => {
    const store = new SettingsStore({ defaults: defaults(), authConfigured: false });
    expect(await store.update({ set: { maxRoomSize: 4 } })).toEqual({ ok: true });
    expect(store.effective()).toMatchObject({ maxRoomSize: 4, warnRoomSize: 4 });
    expect(await store.update({ reset: ['maxRoomSize'] })).toEqual({ ok: true });
    expect(store.effective().warnRoomSize).toBe(6);
  });

  it('allows requiring sign-in only where a provider is configured', async () => {
    const without = new SettingsStore({ defaults: defaults(), authConfigured: false });
    expect(await without.update({ set: { roomCreation: 'signed-in' } })).toMatchObject({ ok: false, errors: { roomCreation: expect.stringContaining('provider') } });
    const withAuth = new SettingsStore({ defaults: defaults(), authConfigured: true });
    expect(await withAuth.update({ set: { roomCreation: 'signed-in', defaultRoomAccess: 'signed-in' } })).toEqual({ ok: true });
    expect(validateTogether(defaults(), { authConfigured: false })).toEqual({});
  });

  describe('live settings', () => {
    it('hands the beacon the relay, its tier and the relay video limits', async () => {
      const store = new SettingsStore({ defaults: defaults(), authConfigured: false });
      expect(store.live()).toMatchObject({ turn: { full: undefined }, defaultTier: undefined });
      await store.update({ set: { turnUrls: ['turn:t:3478'], turnSecret: 'abc', relayVideoKbps: 800 } });
      expect(store.live()).toMatchObject({
        turn: { full: { urls: ['turn:t:3478'], secret: 'abc' } },
        defaultTier: 'full',
        limits: { relayVideoTier: { maxBitrate: 800_000, scaleResolutionDownBy: 2, maxFramerate: 15 } },
      });
    });

    it('gives a changed announcement a new id, and keeps the environment id for the environment text', async () => {
      const store = new SettingsStore({ defaults: defaults({ announcement: 'From env' }), authConfigured: false, defaultAnnouncementId: 'env-id' });
      expect(store.live().announcement).toEqual({ id: 'env-id', text: 'From env' });
      await store.update({ set: { announcement: 'Changed' } });
      const first = store.live().announcement;
      expect(first?.text).toBe('Changed');
      expect(first?.id).toMatch(/^a-[0-9a-f]{8}$/);
      await store.update({ set: { announcement: 'Changed again' } });
      expect(store.live().announcement?.id).not.toBe(first?.id);
      await store.update({ set: { announcement: '' } });
      expect(store.live().announcement).toBeUndefined();
    });
  });

  describe('persistence', () => {
    it('keeps changes across a restart', async () => {
      const file = path.join(tempDir(), 'settings.json');
      await (await SettingsStore.open({ defaults: defaults(), file, authConfigured: false })).update({ set: { maxRoomSize: 5, warnRoomSize: 4 } });
      const again = await SettingsStore.open({ defaults: defaults(), file, authConfigured: false });
      expect(again.effective()).toMatchObject({ maxRoomSize: 5, warnRoomSize: 4 });
      expect(again.isSaved('maxRoomSize')).toBe(true);
    });

    it('writes through a temporary file and leaves only the settings file behind', async () => {
      const dir = tempDir();
      const store = await SettingsStore.open({ defaults: defaults(), file: path.join(dir, 'nested', 'settings.json'), authConfigured: false });
      await store.update({ set: { announcement: 'Hi' } });
      expect(fs.readdirSync(path.join(dir, 'nested'))).toEqual(['settings.json']);
    });

    it('does not change anything when the file cannot be written', async () => {
      const dir = tempDir();
      fs.writeFileSync(path.join(dir, 'blocker'), 'a file where a directory is needed');
      const store = await SettingsStore.open({ defaults: defaults(), file: path.join(dir, 'blocker', 'settings.json'), authConfigured: false });
      expect(await store.update({ set: { maxRoomSize: 5 } })).toMatchObject({ ok: false, errors: { _: expect.stringContaining('could not be saved') } });
      expect(store.effective().maxRoomSize).toBe(10);
    });

    it('ignores a damaged file, and the parts of a file that are not acceptable, with a warning', async () => {
      const dir = tempDir();
      const file = path.join(dir, 'settings.json');
      const warnings: string[] = [];
      const open = () => SettingsStore.open({ defaults: defaults(), file, authConfigured: false, warn: (m) => warnings.push(m) });

      fs.writeFileSync(file, '{ not json');
      expect((await open()).effective()).toEqual(defaults());
      fs.writeFileSync(file, '[1, 2]');
      expect((await open()).effective()).toEqual(defaults());
      expect(warnings).toHaveLength(2);

      fs.writeFileSync(file, JSON.stringify({ maxRoomSize: 6, minClientVersion: 'soon', mystery: true }));
      const partial = await open();
      expect(partial.effective()).toMatchObject({ maxRoomSize: 6, minClientVersion: '0.0.0' });
      expect(partial.isSaved('mystery' as never)).toBe(false);
      expect(warnings).toHaveLength(3);
    });

    it('falls back to the environment when saved values no longer fit together', async () => {
      const file = path.join(tempDir(), 'settings.json');
      await (await SettingsStore.open({ defaults: defaults(), file, authConfigured: true })).update({ set: { roomCreation: 'signed-in' } });
      const warnings: string[] = [];
      // The server was restarted without a sign-in provider.
      const store = await SettingsStore.open({ defaults: defaults(), file, authConfigured: false, warn: (m) => warnings.push(m) });
      expect(store.effective().roomCreation).toBe('anyone');
      expect(warnings.join(' ')).toContain('Ignoring all saved settings');
    });
  });
});
