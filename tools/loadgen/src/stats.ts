/** Collects samples and reports percentiles. Fine for the few hundred thousand samples a load run produces. */
export class Samples {
  private values: number[] = [];
  private sorted = true;

  add(value: number) {
    this.values.push(value);
    this.sorted = false;
  }

  get count() {
    return this.values.length;
  }

  /** The value at percentile `p` (0 to 100), by nearest rank; NaN when empty. */
  percentile(p: number): number {
    if (this.values.length === 0) return NaN;
    if (!this.sorted) {
      this.values.sort((a, b) => a - b);
      this.sorted = true;
    }
    const rank = Math.max(1, Math.ceil((p / 100) * this.values.length));
    return this.values[rank - 1]!;
  }

  get max(): number {
    return this.values.length ? Math.max(...this.values) : NaN;
  }

  summary() {
    return {
      count: this.count,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.max,
    };
  }
}

/** Reads one sample from Prometheus text output (the first series with this exact name, labels ignored). */
export function scrapeValue(text: string, name: string): number | undefined {
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    if (line.startsWith(`${name} `) || line.startsWith(`${name}{`)) {
      const value = Number(line.slice(line.lastIndexOf(' ') + 1));
      return Number.isFinite(value) ? value : undefined;
    }
  }
  return undefined;
}

export class Counts {
  private map = new Map<string, number>();

  inc(key: string, by = 1) {
    this.map.set(key, (this.map.get(key) ?? 0) + by);
  }

  get(key: string) {
    return this.map.get(key) ?? 0;
  }

  toObject() {
    return Object.fromEntries([...this.map].sort(([a], [b]) => a.localeCompare(b)));
  }
}
