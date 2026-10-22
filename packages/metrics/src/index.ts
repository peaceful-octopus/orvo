import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface MetricsOptions {
  /** Share one registry between components that run in the same process (the all-in-one server). */
  registry?: Registry;
  /** Also export process metrics: CPU, memory, file descriptors, event-loop lag (prefixed `chillcall_`). */
  defaultMetrics?: boolean;
}

/** Thin wrapper over prom-client so every service declares and renders metrics the same way. */
export class Metrics {
  readonly registry: Registry;
  readonly contentType: string;

  constructor(opts: MetricsOptions = {}) {
    this.registry = opts.registry ?? new Registry();
    this.contentType = this.registry.contentType;
    if (opts.defaultMetrics) collectDefaultMetrics({ register: this.registry, prefix: 'chillcall_' });
  }

  counter<L extends string = never>(name: string, help: string, labelNames: readonly L[] = []) {
    return new Counter<L>({ name, help, labelNames, registers: [this.registry] });
  }

  /** A gauge whose value is read at scrape time by `collect`. */
  gauge(name: string, help: string, collect: () => number | Promise<number>) {
    return new Gauge({
      name,
      help,
      registers: [this.registry],
      async collect() {
        this.set(await collect());
      },
    });
  }

  histogram<L extends string = never>(name: string, help: string, buckets: number[], labelNames: readonly L[] = []) {
    return new Histogram<L>({ name, help, buckets, labelNames, registers: [this.registry] });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Current value of a counter, gauge or histogram sample (`name_count`, `name_sum`), summed over series whose
   * labels include `labels`. For tests and tools.
   */
  async value(name: string, labels: Record<string, string> = {}): Promise<number> {
    let total = 0;
    for (const family of await this.registry.getMetricsAsJSON()) {
      for (const v of family.values as { value: number; labels: Record<string, string>; metricName?: string }[]) {
        if ((v.metricName ?? family.name) !== name) continue;
        if (Object.entries(labels).every(([k, want]) => String(v.labels[k]) === want)) total += v.value;
      }
    }
    return total;
  }

  /** Names of every metric family registered here. */
  async names(): Promise<string[]> {
    return (await this.registry.getMetricsAsJSON()).map((m) => m.name);
  }
}

/** Exponential-ish buckets for request and join latencies, in seconds. */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export { Registry };
