import { TelemetryBatch, type TelemetryEvent } from '@chillcall/protocol';

export interface TelemetryClientOptions {
  /** Where to send reports: the beacon base URL (the first one that answers is used). */
  beaconUrls: () => string[];
  /** Checked on every report, so turning the setting off takes effect immediately. */
  enabled: () => boolean;
  fetch?: typeof fetch;
  /** Used on page close, when a normal request may be cancelled. */
  sendBeacon?: (url: string, body: Blob) => boolean;
  flushMs?: number;
  maxQueue?: number;
}

/**
 * Collects anonymous connection statistics and sends them to the beacon in batches. It must never get in the
 * way of a call: failures are dropped, the queue is bounded, and nothing is recorded while telemetry is off.
 */
export class TelemetryClient {
  private queue: TelemetryEvent[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private fetchImpl: typeof fetch;
  private maxQueue: number;

  constructor(private opts: TelemetryClientOptions) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.maxQueue = opts.maxQueue ?? 100;
  }

  start() {
    this.timer ??= setInterval(() => void this.flush(), this.opts.flushMs ?? 30_000);
    // Browsers may stop timers in the background; report when the page is hidden or closed.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    void this.flush();
  }

  record(event: TelemetryEvent) {
    if (!this.opts.enabled()) return;
    this.queue.push(event);
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
  }

  /** Sends what has been recorded. Resolves whether or not it succeeded. */
  async flush(): Promise<void> {
    const events = this.take();
    if (events === undefined) return;
    const [url] = this.opts.beaconUrls();
    if (!url) return;
    try {
      await this.fetchImpl(new URL('/v1/telemetry', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, events }),
        keepalive: true,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Dropped on purpose: statistics are not worth retrying or surfacing.
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.flushOnClose();
  };

  private onPageHide = () => this.flushOnClose();

  private flushOnClose() {
    const events = this.take();
    const [url] = this.opts.beaconUrls();
    if (!events || !url) return;
    // text/plain is a CORS-safelisted type, so the browser sends it without a preflight that a closing page cannot wait for.
    const body = new Blob([JSON.stringify({ v: 1, events })], { type: 'text/plain;charset=UTF-8' });
    const send = this.opts.sendBeacon ?? (typeof navigator !== 'undefined' ? navigator.sendBeacon?.bind(navigator) : undefined);
    try {
      send?.(new URL('/v1/telemetry', url).toString(), body);
    } catch {
      // Same as flush: never let reporting disturb the app.
    }
  }

  /** Takes the queued events, validated, or undefined when there is nothing to send or telemetry is off. */
  private take(): TelemetryEvent[] | undefined {
    if (!this.opts.enabled() || this.queue.length === 0) {
      this.queue = this.opts.enabled() ? this.queue : [];
      return undefined;
    }
    const events = this.queue.splice(0, this.queue.length);
    const batch = TelemetryBatch.safeParse({ v: 1, events: events.slice(0, 50) });
    if (events.length > 50) this.queue.unshift(...events.slice(50));
    return batch.success ? batch.data.events : undefined;
  }
}
