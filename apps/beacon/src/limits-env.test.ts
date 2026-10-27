import { DEFAULT_RELAY_VIDEO_TIER } from '@orvo/protocol';
import { describe, expect, it } from 'vitest';
import { relayVideoTierFromEnv } from './limits-env';

describe('relayVideoTierFromEnv', () => {
  it('leaves the built-in default alone when nothing is set', () => {
    expect(relayVideoTierFromEnv({})).toBeUndefined();
    expect(relayVideoTierFromEnv({ RELAY_VIDEO_KBPS: '' })).toBeUndefined();
  });

  it('replaces only the parts that are set', () => {
    expect(relayVideoTierFromEnv({ RELAY_VIDEO_KBPS: '800' })).toEqual({ ...DEFAULT_RELAY_VIDEO_TIER, maxBitrate: 800_000 });
    expect(relayVideoTierFromEnv({ RELAY_VIDEO_KBPS: '1000', RELAY_VIDEO_SCALE: '1', RELAY_VIDEO_FPS: '30' })).toEqual({
      maxBitrate: 1_000_000,
      scaleResolutionDownBy: 1,
      maxFramerate: 30,
    });
  });

  it('refuses values that would make no sense', () => {
    for (const env of [{ RELAY_VIDEO_KBPS: 'fast' }, { RELAY_VIDEO_KBPS: '0' }, { RELAY_VIDEO_SCALE: '0.5' }, { RELAY_VIDEO_FPS: '12.5' }]) {
      expect(() => relayVideoTierFromEnv(env)).toThrow(/must be/);
    }
  });
});
