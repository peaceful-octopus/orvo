import { describe, expect, it } from 'vitest';
import { Counts, Samples, scrapeValue } from './stats';

describe('Samples', () => {
  it('reports nearest-rank percentiles regardless of insertion order', () => {
    const s = new Samples();
    for (const v of [5, 1, 9, 3, 7, 2, 8, 4, 6, 10]) s.add(v);
    expect(s.percentile(50)).toBe(5);
    expect(s.percentile(90)).toBe(9);
    expect(s.percentile(99)).toBe(10);
    expect(s.percentile(0)).toBe(1);
    expect(s.max).toBe(10);
    expect(s.count).toBe(10);
  });

  it('keeps percentiles right when samples arrive after a read', () => {
    const s = new Samples();
    s.add(10);
    expect(s.percentile(99)).toBe(10);
    s.add(1);
    s.add(100);
    expect(s.percentile(99)).toBe(100);
    expect(s.percentile(1)).toBe(1);
  });

  it('is NaN when empty', () => {
    expect(Number.isNaN(new Samples().percentile(99))).toBe(true);
    expect(Number.isNaN(new Samples().max)).toBe(true);
  });
});

describe('scrapeValue', () => {
  const text = [
    '# HELP orvo_signaling_connections Open connections.',
    '# TYPE orvo_signaling_connections gauge',
    'orvo_signaling_connections 42',
    'orvo_signaling_join_failures_total{code="room-full"} 3',
    'orvo_process_resident_memory_bytes 123456789',
  ].join('\n');

  it('reads plain and labeled series by name', () => {
    expect(scrapeValue(text, 'orvo_signaling_connections')).toBe(42);
    expect(scrapeValue(text, 'orvo_signaling_join_failures_total')).toBe(3);
    expect(scrapeValue(text, 'orvo_process_resident_memory_bytes')).toBe(123456789);
  });

  it('does not confuse a name with a longer one, and ignores comments', () => {
    expect(scrapeValue(text, 'orvo_signaling_conn')).toBeUndefined();
    expect(scrapeValue(text, 'missing_metric')).toBeUndefined();
  });
});

describe('Counts', () => {
  it('counts by key and lists them sorted', () => {
    const c = new Counts();
    c.inc('b');
    c.inc('a', 2);
    c.inc('b');
    expect(c.get('b')).toBe(2);
    expect(c.get('zzz')).toBe(0);
    expect(Object.keys(c.toObject())).toEqual(['a', 'b']);
  });
});
