export const MAX_ROOM_SIZE = 20;
export const WARN_ROOM_SIZE = 12;

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
 * (a room of 20 needs about 8.1 Mbps up), and roughly double that while sharing a screen.
 */
export const DEFAULT_VIDEO_TIERS: VideoTierRule[] = [
  { maxPeers: 6, maxBitrate: 1_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { maxPeers: 8, maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { maxPeers: 10, maxBitrate: 800_000, scaleResolutionDownBy: 1.25, maxFramerate: 30 },
  { maxPeers: WARN_ROOM_SIZE, maxBitrate: 650_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
  // Beyond this each person encodes and decodes a stream per peer, so resolution and frame rate fall along with bitrate.
  { maxPeers: 16, maxBitrate: 450_000, scaleResolutionDownBy: 2, maxFramerate: 24 },
  { maxPeers: MAX_ROOM_SIZE, maxBitrate: 350_000, scaleResolutionDownBy: 2, maxFramerate: 20 },
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

/** Audio sent to each peer, on the wire (Opus plus packet headers). */
export const AUDIO_WIRE_BPS = 60_000;
/** Packet header overhead on top of the video bitrate. */
const VIDEO_OVERHEAD = 1.05;
/** Part of a measured uplink that calls may use; the rest absorbs other traffic and errors in the measurement. */
export const USABLE_UPLINK = 0.7;
/** Below this per-peer video bitrate the picture is not worth sending, and the camera is treated as off. */
export const MIN_VIDEO_BPS = 100_000;

/** Rooms of up to this many people can send more than the room's tier to each peer, when the uplink has been measured to carry it. */
export const SMALL_ROOM_PEERS = 5;
/** The most video to each peer in such a room: a sharp 720p picture at 30 frames per second. */
export const SMALL_ROOM_BITRATE = 2_500_000;

export interface AdaptiveVideo {
  /** False when the uplink cannot carry video to this many people. */
  video: boolean;
  tier: VideoTier;
  /** Whether the uplink, and not the room's size tier, set the limits. */
  limitedByUplink: boolean;
}

/** Picture size and frame rate that suit a bitrate. */
function ladder(bps: number): { scaleResolutionDownBy: number; maxFramerate: number } {
  if (bps >= 900_000) return { scaleResolutionDownBy: 1, maxFramerate: 30 };
  if (bps >= 600_000) return { scaleResolutionDownBy: 1.25, maxFramerate: 30 };
  if (bps >= 400_000) return { scaleResolutionDownBy: 1.5, maxFramerate: 24 };
  if (bps >= 200_000) return { scaleResolutionDownBy: 2, maxFramerate: 20 };
  return { scaleResolutionDownBy: 3, maxFramerate: 15 };
}

/**
 * What one person can send each of the others. Rooms are a full mesh, so the uplink is shared by (people - 1) copies of
 * the camera, plus the same again for each shared screen, plus audio. The room's tier is a ceiling; a slower uplink lowers
 * bitrate, picture size and frame rate to fit, and below `MIN_VIDEO_BPS` leaves video off. A small room, whose few
 * encoders cost little, goes above its tier up to `SMALL_ROOM_BITRATE` when the measured uplink allows. Relayed paths are
 * limited separately (see `sendPolicy`), so this costs a relay nothing. Without a measurement the room's tier applies as it is.
 */
export function adaptiveVideoTier(
  peerCount: number,
  uplinkKbps: number | undefined,
  tiers: VideoTierRule[] = DEFAULT_VIDEO_TIERS,
  videoStreams = 1,
): AdaptiveVideo {
  const roomTier = videoTierFor(peerCount, tiers);
  const others = Math.max(1, peerCount - 1);
  if (uplinkKbps === undefined || !(uplinkKbps > 0) || peerCount < 2) return { video: true, tier: roomTier, limitedByUplink: false };
  const perStream = (uplinkKbps * 1000 * USABLE_UPLINK) / others;
  const bps = Math.floor((perStream - AUDIO_WIRE_BPS) / Math.max(1, videoStreams) / VIDEO_OVERHEAD);
  if (bps >= roomTier.maxBitrate) {
    const ceiling = peerCount <= SMALL_ROOM_PEERS ? Math.max(roomTier.maxBitrate, SMALL_ROOM_BITRATE) : roomTier.maxBitrate;
    return { video: true, tier: { ...roomTier, maxBitrate: Math.min(bps, ceiling) }, limitedByUplink: false };
  }
  if (bps < MIN_VIDEO_BPS) return { video: false, tier: { ...roomTier, maxBitrate: MIN_VIDEO_BPS }, limitedByUplink: true };
  const fit = ladder(bps);
  return {
    video: true,
    tier: {
      maxBitrate: bps,
      scaleResolutionDownBy: Math.max(roomTier.scaleResolutionDownBy, fit.scaleResolutionDownBy),
      maxFramerate: Math.min(roomTier.maxFramerate, fit.maxFramerate),
    },
    limitedByUplink: true,
  };
}

/** The most a beacon accepts in one upload test. */
export const UPLINK_TEST_MAX_BYTES = 3 * 1024 * 1024;
