export const MAX_ROOM_SIZE = 10;
export const WARN_ROOM_SIZE = 6;

export interface VideoTier {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

export interface VideoTierRule extends VideoTier {
  /** Applies while the room has at most this many participants. */
  maxPeers: number;
}

/** Built-in tiers, used until a signed config supplies its own. */
export const DEFAULT_VIDEO_TIERS: VideoTierRule[] = [
  { maxPeers: 4, maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { maxPeers: WARN_ROOM_SIZE, maxBitrate: 500_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
  { maxPeers: MAX_ROOM_SIZE, maxBitrate: 250_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
];

/** Video limits for a path through a relay, which costs bandwidth and usually has less of it. */
export const DEFAULT_RELAY_VIDEO_TIER: VideoTier = { maxBitrate: 200_000, scaleResolutionDownBy: 2, maxFramerate: 15 };

/** Per-sender video limits for a mesh room with `peerCount` participants (including self). */
export function videoTierFor(peerCount: number, tiers: VideoTierRule[] = DEFAULT_VIDEO_TIERS): VideoTier {
  const sorted = [...tiers].sort((a, b) => a.maxPeers - b.maxPeers);
  const rule = sorted.find((t) => peerCount <= t.maxPeers) ?? sorted[sorted.length - 1]!;
  return { maxBitrate: rule.maxBitrate, scaleResolutionDownBy: rule.scaleResolutionDownBy, maxFramerate: rule.maxFramerate };
}

export function roomStatus(
  peerCount: number,
  limits: { maxRoomSize: number; warnRoomSize: number } = { maxRoomSize: MAX_ROOM_SIZE, warnRoomSize: WARN_ROOM_SIZE },
): 'ok' | 'degraded' | 'full' {
  if (peerCount >= limits.maxRoomSize) return 'full';
  if (peerCount > limits.warnRoomSize) return 'degraded';
  return 'ok';
}
