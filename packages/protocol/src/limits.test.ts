import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_TIERS, MIN_VIDEO_BPS, adaptiveVideoTier, MAX_ROOM_SIZE, WARN_ROOM_SIZE, roomStatus, videoTierFor } from './limits';

describe('roomStatus', () => {
  it('is ok up to the warning size, degraded above it, full at the maximum', () => {
    expect(roomStatus(WARN_ROOM_SIZE)).toBe('ok');
    expect(roomStatus(WARN_ROOM_SIZE + 1)).toBe('degraded');
    expect(roomStatus(MAX_ROOM_SIZE - 1)).toBe('degraded');
    expect(roomStatus(MAX_ROOM_SIZE)).toBe('full');
  });

  it('uses limits supplied by a config', () => {
    const limits = { maxRoomSize: 4, warnRoomSize: 2 };
    expect([1, 2, 3, 4].map((n) => roomStatus(n, limits))).toEqual(['ok', 'ok', 'degraded', 'full']);
  });
});

describe('videoTierFor', () => {
  it('lowers bitrate as the room grows', () => {
    const sizes = [2, WARN_ROOM_SIZE, MAX_ROOM_SIZE].map((n) => videoTierFor(n).maxBitrate);
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    expect(sizes[1]).toBeGreaterThan(sizes[2]!);
  });

  it('picks the first tier that fits regardless of order, and the last tier for oversize rooms', () => {
    const shuffled = [...DEFAULT_VIDEO_TIERS].reverse();
    const sorted = [...DEFAULT_VIDEO_TIERS].sort((a, b) => a.maxPeers - b.maxPeers);
    expect(videoTierFor(2, shuffled).maxBitrate).toBe(sorted[0]!.maxBitrate);
    expect(videoTierFor(sorted[0]!.maxPeers + 1, shuffled).maxBitrate).toBe(sorted[1]!.maxBitrate);
    expect(videoTierFor(99, shuffled).maxBitrate).toBe(sorted[sorted.length - 1]!.maxBitrate);
  });

  it('applies tiers from a config', () => {
    const tiers = [{ maxPeers: 2, maxBitrate: 123, scaleResolutionDownBy: 1, maxFramerate: 10 }];
    expect(videoTierFor(2, tiers)).toEqual({ maxBitrate: 123, scaleResolutionDownBy: 1, maxFramerate: 10 });
  });
});

describe('adaptiveVideoTier', () => {
  it('uses the room tier when the uplink is not known', () => {
    expect(adaptiveVideoTier(MAX_ROOM_SIZE, undefined)).toEqual({ video: true, tier: videoTierFor(MAX_ROOM_SIZE), limitedByUplink: false });
  });

  it('uses the room tier when the uplink is ample', () => {
    const result = adaptiveVideoTier(MAX_ROOM_SIZE, 12_000);
    expect(result.limitedByUplink).toBe(false);
    expect(result.tier).toEqual(videoTierFor(MAX_ROOM_SIZE));
  });

  it('lowers bitrate, picture size and frame rate to fit a slower uplink', () => {
    const fast = adaptiveVideoTier(6, 12_000).tier;
    const slow = adaptiveVideoTier(6, 3_000);
    expect(slow.limitedByUplink).toBe(true);
    expect(slow.video).toBe(true);
    expect(slow.tier.maxBitrate).toBeLessThan(fast.maxBitrate);
    expect(slow.tier.scaleResolutionDownBy).toBeGreaterThan(fast.scaleResolutionDownBy);
    // What it sends to the other five stays within the usable part of the uplink.
    expect(slow.tier.maxBitrate * 5).toBeLessThan(3_000_000);
  });

  it('never asks for more than the room tier, however fast the uplink', () => {
    expect(adaptiveVideoTier(MAX_ROOM_SIZE, 1_000_000).tier.maxBitrate).toBe(videoTierFor(MAX_ROOM_SIZE).maxBitrate);
  });

  it('leaves video off when the uplink cannot carry a usable picture to everyone', () => {
    const result = adaptiveVideoTier(MAX_ROOM_SIZE, 1_000);
    expect(result.video).toBe(false);
    expect(result.tier.maxBitrate).toBe(MIN_VIDEO_BPS);
  });

  it('shares the uplink with a shared screen', () => {
    const camera = adaptiveVideoTier(8, 4_000).tier.maxBitrate;
    const withScreen = adaptiveVideoTier(8, 4_000, undefined, 2).tier.maxBitrate;
    expect(withScreen).toBeLessThan(camera);
  });

  it('applies to a room of two the same way', () => {
    expect(adaptiveVideoTier(2, 500).limitedByUplink).toBe(true);
  });
});
