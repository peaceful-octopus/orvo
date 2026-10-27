import { DEFAULT_RELAY_VIDEO_TIER, type VideoTier } from '@orvo/protocol';

const positive = (name: string, value: string | undefined, min: number, integer: boolean): number | undefined => {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be ${integer ? 'a whole number' : 'a number'} of at least ${min}, not "${value}".`);
  }
  return n;
};

/** The three relay video settings, each unset (`null`) to keep the built-in default for that part. */
export interface RelayVideoSettings {
  kbps: number | null;
  scale: number | null;
  fps: number | null;
}

/** What clients may send over a relay: the set parts replace their part of the built-in default; none set means no change. */
export function relayVideoTier({ kbps, scale, fps }: RelayVideoSettings): VideoTier | undefined {
  if (kbps === null && scale === null && fps === null) return undefined;
  return {
    maxBitrate: kbps !== null ? kbps * 1000 : DEFAULT_RELAY_VIDEO_TIER.maxBitrate,
    scaleResolutionDownBy: scale ?? DEFAULT_RELAY_VIDEO_TIER.scaleResolutionDownBy,
    maxFramerate: fps ?? DEFAULT_RELAY_VIDEO_TIER.maxFramerate,
  };
}

/** Reads and checks the three settings from the environment. */
export function relayVideoSettingsFromEnv(env: Record<string, string | undefined>): RelayVideoSettings {
  return {
    kbps: positive('RELAY_VIDEO_KBPS', env.RELAY_VIDEO_KBPS, 1, true) ?? null,
    scale: positive('RELAY_VIDEO_SCALE', env.RELAY_VIDEO_SCALE, 1, false) ?? null,
    fps: positive('RELAY_VIDEO_FPS', env.RELAY_VIDEO_FPS, 1, true) ?? null,
  };
}

/**
 * What video quality clients may send over a relay, from the environment. Each setting replaces its part of the
 * built-in default (200 kbit/s, half size, 15 frames a second), so setting none leaves the default in place:
 *   RELAY_VIDEO_KBPS    the most video, in kilobits a second, sent to someone reached through the relay
 *   RELAY_VIDEO_SCALE   how much smaller than the camera the picture is sent (1 is full size, 2 is half in each direction)
 *   RELAY_VIDEO_FPS     the most frames a second
 * Everything through a relay uses the operator's bandwidth, which is why the default is low.
 */
export function relayVideoTierFromEnv(env: Record<string, string | undefined>): VideoTier | undefined {
  return relayVideoTier(relayVideoSettingsFromEnv(env));
}
