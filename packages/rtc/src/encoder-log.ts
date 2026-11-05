import type { StatsLike } from './route';

export interface EncoderSummary {
  /** Polls in which video was being encoded. */
  samples: number;
  /** Of those, polls where a browser said it was holding quality down because the CPU could not keep up. */
  cpuLimited: number;
  /** And because the network could not carry more. */
  bandwidthLimited: number;
  /** Average time to encode one frame, in milliseconds. */
  encodeMs: number;
  /** The most video connections open at once. */
  peers: number;
  /** Whether a hardware encoder was in use at any point. */
  hardware: boolean;
}

interface Counters {
  frames: number;
  seconds: number;
}

/**
 * Collects what each connection's video encoder reports over a call, to see whether encoding is ever the limit. Every
 * connection has its own encoder, so the browser's stats are read per connection and summed here. Only
 * counts and averages are kept.
 */
export class EncoderLog {
  private last = new Map<string, Counters>();
  private samples = 0;
  private cpuLimited = 0;
  private bandwidthLimited = 0;
  private frames = 0;
  private seconds = 0;
  private peers = 0;
  private hardware = false;
  private open = new Set<string>();

  /** Reads one connection's stats report. Browsers that do not report these fields add nothing. */
  add(connection: string, report: StatsLike) {
    let encoding = false;
    let cpu = false;
    let bandwidth = false;
    report.forEach((stat) => {
      if (stat.type !== 'outbound-rtp' || (stat.kind ?? stat.mediaType) !== 'video') return;
      const frames = Number(stat.framesEncoded);
      const seconds = Number(stat.totalEncodeTime);
      if (!Number.isFinite(frames) || !Number.isFinite(seconds)) return;
      const key = `${connection}/${String(stat.id ?? stat.ssrc ?? '')}`;
      const before = this.last.get(key);
      this.last.set(key, { frames, seconds });
      if (!before || frames <= before.frames) return; // nothing new was encoded since the last poll
      encoding = true;
      this.frames += frames - before.frames;
      this.seconds += Math.max(0, seconds - before.seconds);
      if (stat.qualityLimitationReason === 'cpu') cpu = true;
      if (stat.qualityLimitationReason === 'bandwidth') bandwidth = true;
      if (stat.powerEfficientEncoder === true) this.hardware = true;
    });
    if (!encoding) return;
    this.open.add(connection);
    this.peers = Math.max(this.peers, this.open.size);
    this.samples += 1;
    if (cpu) this.cpuLimited += 1;
    if (bandwidth) this.bandwidthLimited += 1;
  }

  /** A connection ended; its counters are not needed again. */
  remove(connection: string) {
    this.open.delete(connection);
    for (const key of this.last.keys()) if (key.startsWith(`${connection}/`)) this.last.delete(key);
  }

  /** The totals so far, or undefined when no video was encoded. */
  summary(): EncoderSummary | undefined {
    if (this.samples === 0 || this.frames === 0) return undefined;
    return {
      samples: this.samples,
      cpuLimited: this.cpuLimited,
      bandwidthLimited: this.bandwidthLimited,
      encodeMs: Math.round((this.seconds * 1000) / this.frames),
      peers: this.peers,
      hardware: this.hardware,
    };
  }

  reset() {
    this.last.clear();
    this.open.clear();
    this.samples = this.cpuLimited = this.bandwidthLimited = this.frames = this.seconds = this.peers = 0;
    this.hardware = false;
  }
}
