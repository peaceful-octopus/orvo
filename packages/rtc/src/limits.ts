export const MAX_ROOM_SIZE = 10;
export const WARN_ROOM_SIZE = 6;

export interface VideoTier {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

/** Per-sender video limits for a mesh room with `peerCount` participants (including self). */
export function videoTierFor(peerCount: number): VideoTier {
  if (peerCount <= 4) return { maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 };
  if (peerCount <= WARN_ROOM_SIZE) return { maxBitrate: 500_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 };
  return { maxBitrate: 250_000, scaleResolutionDownBy: 2, maxFramerate: 15 };
}

export function roomStatus(peerCount: number): 'ok' | 'degraded' | 'full' {
  if (peerCount >= MAX_ROOM_SIZE) return 'full';
  if (peerCount > WARN_ROOM_SIZE) return 'degraded';
  return 'ok';
}
