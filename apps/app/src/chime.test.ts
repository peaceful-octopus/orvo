import { describe, expect, it } from 'vitest';
import { chimeNotes } from './chime';

describe('chimeNotes', () => {
  it('rises when someone joins and falls when they leave', () => {
    const join = chimeNotes('join');
    const leave = chimeNotes('leave');
    expect(join[1]!.freq).toBeGreaterThan(join[0]!.freq);
    expect(leave[1]!.freq).toBeLessThan(leave[0]!.freq);
  });

  it('keeps the leave chime shorter and quieter than the join chime', () => {
    const end = (kind: 'join' | 'leave') => Math.max(...chimeNotes(kind).map((n) => n.start + n.decay));
    const peak = (kind: 'join' | 'leave') => Math.max(...chimeNotes(kind).map((n) => n.gain));
    expect(end('leave')).toBeLessThan(end('join'));
    expect(peak('leave')).toBeLessThan(peak('join'));
  });

  it('stays in a gentle range', () => {
    for (const kind of ['join', 'leave'] as const) {
      for (const n of chimeNotes(kind)) {
        expect(n.freq).toBeGreaterThan(400);
        expect(n.freq).toBeLessThan(2000);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
        expect(n.decay).toBeLessThan(1.5);
      }
    }
  });
});
