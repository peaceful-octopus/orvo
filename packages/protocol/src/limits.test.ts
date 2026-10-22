import { describe, expect, it } from 'vitest';
import { MAX_ROOM_SIZE, roomStatus, videoTierFor } from './limits';

describe('roomStatus', () => {
  it('is ok up to 6, degraded 7-9, full at 10', () => {
    expect(roomStatus(6)).toBe('ok');
    expect(roomStatus(7)).toBe('degraded');
    expect(roomStatus(MAX_ROOM_SIZE - 1)).toBe('degraded');
    expect(roomStatus(MAX_ROOM_SIZE)).toBe('full');
  });
});

describe('videoTierFor', () => {
  it('lowers bitrate as the room grows', () => {
    const sizes = [2, 5, 8].map((n) => videoTierFor(n).maxBitrate);
    expect(sizes).toEqual([1_000_000, 500_000, 250_000]);
  });
});
