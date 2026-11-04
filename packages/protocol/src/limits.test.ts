import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_TIERS, MAX_ROOM_SIZE, WARN_ROOM_SIZE, roomStatus, videoTierFor } from './limits';

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
