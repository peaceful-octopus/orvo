import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_TIERS, MAX_ROOM_SIZE, roomStatus, videoTierFor } from './limits';

describe('roomStatus', () => {
  it('is ok up to 6, degraded 7-9, full at 10', () => {
    expect(roomStatus(6)).toBe('ok');
    expect(roomStatus(7)).toBe('degraded');
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
    const sizes = [2, 5, 8].map((n) => videoTierFor(n).maxBitrate);
    expect(sizes).toEqual([1_000_000, 500_000, 250_000]);
  });

  it('picks the first tier that fits regardless of order, and the last tier for oversize rooms', () => {
    const shuffled = [...DEFAULT_VIDEO_TIERS].reverse();
    expect(videoTierFor(4, shuffled).maxBitrate).toBe(1_000_000);
    expect(videoTierFor(5, shuffled).maxBitrate).toBe(500_000);
    expect(videoTierFor(99, shuffled).maxBitrate).toBe(250_000);
  });

  it('applies tiers from a config', () => {
    const tiers = [{ maxPeers: 2, maxBitrate: 123, scaleResolutionDownBy: 1, maxFramerate: 10 }];
    expect(videoTierFor(2, tiers)).toEqual({ maxBitrate: 123, scaleResolutionDownBy: 1, maxFramerate: 10 });
  });
});
