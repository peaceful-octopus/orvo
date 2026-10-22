/** Minimal Prometheus text exposition: labeled counters plus gauges computed at scrape time. */
export class Metrics {
  private counters = new Map<string, number>();

  inc(name: string, labels: Record<string, string> = {}, by = 1) {
    const key = `${name}${formatLabels(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  get(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(`${name}${formatLabels(labels)}`) ?? 0;
  }

  render(gauges: Record<string, number> = {}): string {
    const lines = [...this.counters].map(([key, value]) => `${key} ${value}`);
    for (const [name, value] of Object.entries(gauges)) lines.push(`${name} ${value}`);
    return `${lines.join('\n')}\n`;
  }
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}` : '';
}
