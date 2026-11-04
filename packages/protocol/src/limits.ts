export const MAX_ROOM_SIZE = 12;
export const WARN_ROOM_SIZE = 8;

export interface VideoTier {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

export interface VideoTierRule extends VideoTier {
  /** Applies while the room has at most this many participants. */
  maxPeers: number;
}

/**
 * Built-in tiers, used until a signed config supplies its own. Rooms are a full mesh, so one person uploads their video to
 * each of the others: (people - 1) x (video + about 60 kbps of audio, with 5% packet overhead). The tiers are sized so that
 * a 12 Mbps uplink, of which 70% is counted as usable, can carry the camera at every room size up to MAX_ROOM_SIZE
 * (a room of 12 needs about 8.2 Mbps up), and roughly double that while sharing a screen.
 */
export const DEFAULT_VIDEO_TIERS: VideoTierRule[] = [
  { maxPeers: 6, maxBitrate: 1_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { maxPeers: WARN_ROOM_SIZE, maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { maxPeers: 10, maxBitrate: 800_000, scaleResolutionDownBy: 1.25, maxFramerate: 30 },
  { maxPeers: MAX_ROOM_SIZE, maxBitrate: 650_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
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
