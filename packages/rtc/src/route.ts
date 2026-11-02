import type { Tier, VideoTier } from '@orvo/protocol';

export type Route = 'direct' | 'relay' | 'unknown';

type Stat = Record<string, unknown>;

/** Anything that behaves like RTCStatsReport: iterable of [id, stats] with `get` and `forEach`. */
export interface StatsLike {
  get(id: string): Stat | undefined;
  forEach(callback: (stat: Stat) => void): void;
}

/** The two ends of the candidate pair a connection is using, as their stats entries. */
export interface SelectedPair {
  local?: Stat;
  remote?: Stat;
}

/**
 * The candidate pair in use: the transport's selected pair when the browser reports one, else the nominated succeeded
 * pair (older Firefox and Safari).
 */
export function selectedPair(report: StatsLike): SelectedPair | undefined {
  let pair: Stat | undefined;
  report.forEach((stat) => {
    if (stat.type === 'transport' && typeof stat.selectedCandidatePairId === 'string') {
      pair ??= report.get(stat.selectedCandidatePairId);
    }
  });
  if (!pair) {
    report.forEach((stat) => {
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) pair ??= stat;
    });
  }
  if (!pair) return undefined;
  const end = (id: unknown) => (typeof id === 'string' ? report.get(id) : undefined);
  return { local: end(pair.localCandidateId), remote: end(pair.remoteCandidateId) };
}

/** Whether the selected candidate pair goes through a relay. */
export function routeFromStats(report: StatsLike): Route {
  const pair = selectedPair(report);
  if (!pair) return 'unknown';
  const types = [pair.local, pair.remote].map((end) => end?.candidateType as string | undefined);
  if (types.every((t) => t === undefined)) return 'unknown';
  return types.includes('relay') ? 'relay' : 'direct';
}

/** A candidate's address and port from its stats entry; older browsers call the address `ip`. */
export function candidateAddress(stat: Stat | undefined): { address: string; port: number } | undefined {
  const address = stat?.address ?? stat?.ip;
  return typeof address === 'string' && typeof stat?.port === 'number' ? { address, port: stat.port } : undefined;
}

/** What to send to one peer, given how the connection to them is routed. */
export interface SendPolicy {
  /** False when video should not be sent at all, because the path cannot carry it. */
  video: boolean;
  tier: VideoTier;
}

/**
 * Relayed paths are the expensive ones, so they get a lower video tier. A `relay-lite` room's relay is capped
 * around audio speeds, so video is not sent over it at all. `tier` is the room's usual tier for this room size.
 */
export function sendPolicy(route: Route, roomTier: Tier, normal: VideoTier, relayed: VideoTier): SendPolicy {
  if (route !== 'relay') return { video: true, tier: normal };
  if (roomTier === 'relay-lite') return { video: false, tier: relayed };
  return { video: true, tier: normal.maxBitrate < relayed.maxBitrate ? normal : relayed };
}
