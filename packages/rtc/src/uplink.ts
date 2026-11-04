import { UPLINK_TEST_MAX_BYTES } from '@orvo/protocol';

type Fetch = typeof fetch;

export interface UplinkOptions {
  fetch?: Fetch;
  now?: () => number;
  /** Beacon base URLs in preference order. */
  beaconUrls: string[];
}

/** Upload sizes tried in turn; a slow connection stops at a small one rather than spending many seconds on a test. */
const STAGES = [96 * 1024, 512 * 1024, 2 * 1024 * 1024].map((n) => Math.min(n, UPLINK_TEST_MAX_BYTES - 1024));
/** A stage that took this long is long enough to read a speed from, so the next, larger one is skipped. */
const ENOUGH_MS = 700;
const TIMEOUT_MS = 8_000;
/** Readings above this are not told apart; the call needs far less. */
const CEILING_KBPS = 100_000;

/** A block of data in the form the beacon accepts without a preflight request: a JSON string. */
const payload = (bytes: number) => JSON.stringify('x'.repeat(Math.max(0, bytes - 2)));

/**
 * Estimates how fast this device can send data, in kilobits per second, by timing uploads to the beacon. The time
 * for a small request first is taken off each upload as the round trip. Returns undefined when it cannot tell
 * (offline, the beacon is old and lacks the route, or the connection is too unsteady to read).
 */
export async function measureUplinkKbps({ fetch: fetchImpl = (...a) => fetch(...a), now = () => performance.now(), beaconUrls }: UplinkOptions): Promise<number | undefined> {
  for (const base of beaconUrls) {
    const url = new URL('/v1/uplink-test', base).toString();
    const send = async (bytes: number): Promise<number | undefined> => {
      const started = now();
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: payload(bytes),
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return res.ok ? now() - started : undefined;
      } catch {
        return undefined;
      }
    };

    const rtt = await send(64);
    if (rtt === undefined) continue; // this beacon does not answer; try the next
    let best: number | undefined;
    for (const bytes of STAGES) {
      const ms = await send(bytes);
      if (ms === undefined) break;
      const transfer = Math.max(ms - rtt, ms * 0.2, 1); // never let the round-trip correction produce an absurd speed
      const kbps = Math.min(CEILING_KBPS, (bytes * 8) / transfer);
      best = Math.max(best ?? 0, kbps);
      if (ms >= ENOUGH_MS) break;
    }
    if (best !== undefined) return Math.round(best);
  }
  return undefined;
}
