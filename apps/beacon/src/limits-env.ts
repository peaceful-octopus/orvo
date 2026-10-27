import { DEFAULT_RELAY_VIDEO_TIER, type VideoTier } from '@orvo/protocol';

const positive = (name: string, value: string | undefined, min: number, integer: boolean): number | undefined => {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new Error(`${name} must be ${integer ? 'a whole number' : 'a number'} of at least ${min}, not "${value}".`);
  }
  return n;
};

/**
 * What video quality clients may send over a relay, from the environment. Each setting replaces its part of the
 * built-in default (200 kbit/s, half size, 15 frames a second), so setting none leaves the default in place:
 *   RELAY_VIDEO_KBPS    the most video, in kilobits a second, sent to someone reached through the relay
 *   RELAY_VIDEO_SCALE   how much smaller than the camera the picture is sent (1 is full size, 2 is half in each direction)
 *   RELAY_VIDEO_FPS     the most frames a second
 * Everything through a relay uses the operator's bandwidth, which is why the default is low.
 */
export function relayVideoTierFromEnv(env: Record<string, string | undefined>): VideoTier | undefined {
  const kbps = positive('RELAY_VIDEO_KBPS', env.RELAY_VIDEO_KBPS, 1, true);
  const scale = positive('RELAY_VIDEO_SCALE', env.RELAY_VIDEO_SCALE, 1, false);
  const fps = positive('RELAY_VIDEO_FPS', env.RELAY_VIDEO_FPS, 1, true);
  if (kbps === undefined && scale === undefined && fps === undefined) return undefined;
  return {
    maxBitrate: kbps !== undefined ? kbps * 1000 : DEFAULT_RELAY_VIDEO_TIER.maxBitrate,
    scaleResolutionDownBy: scale ?? DEFAULT_RELAY_VIDEO_TIER.scaleResolutionDownBy,
    maxFramerate: fps ?? DEFAULT_RELAY_VIDEO_TIER.maxFramerate,
  };
}
