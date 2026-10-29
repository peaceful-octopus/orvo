import { describe, expect, it } from 'vitest';
import { chimeNotes, type ChimeKind } from './chime';

describe('chimeNotes', () => {
  it('rises when someone joins or an activity starts, and falls when they leave or it ends', () => {
    const pitches = (kind: ChimeKind) => chimeNotes(kind).map((n) => n.freq);
    const ascending = (list: number[]) => list.every((f, i) => i === 0 || f > list[i - 1]!);
    expect(ascending(pitches('join'))).toBe(true);
    expect(ascending(pitches('activity-start'))).toBe(true);
    expect(ascending(pitches('leave').reverse())).toBe(true);
    expect(ascending(pitches('activity-end').reverse())).toBe(true);
  });

  it('gives activities three notes, so they differ from the two of joining and leaving', () => {
    expect(chimeNotes('activity-start')).toHaveLength(3);
    expect(chimeNotes('activity-end')).toHaveLength(3);
    expect(chimeNotes('join')).toHaveLength(2);
    expect(chimeNotes('leave')).toHaveLength(2);
  });

  it('keeps the leave chime shorter and quieter than the join chime', () => {
    const end = (kind: ChimeKind) => Math.max(...chimeNotes(kind).map((n) => n.start + n.decay));
    const peak = (kind: ChimeKind) => Math.max(...chimeNotes(kind).map((n) => n.gain));
    expect(end('leave')).toBeLessThan(end('join'));
    expect(peak('leave')).toBeLessThan(peak('join'));
    expect(peak('activity-end')).toBeLessThan(peak('activity-start'));
  });

  it('stays in a gentle range', () => {
    for (const kind of ['join', 'leave', 'activity-start', 'activity-end'] as const) {
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
