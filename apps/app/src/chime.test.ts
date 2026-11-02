import { describe, expect, it } from 'vitest';
import { chimeDurationMs, chimeNotes, encodeChime, type ChimeKind } from './chime';

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

  it('describes the notes for the Android app as freq:start:decay:gain, one note after another', () => {
    expect(encodeChime('leave')).toBe('1046.5:0:0.6:0.6|783.99:0.12:0.8:0.5');
    for (const kind of ['join', 'leave', 'activity-start', 'activity-end'] as const) {
      expect(encodeChime(kind).split('|')).toHaveLength(chimeNotes(kind).length);
    }
  });

  it('reports how long a chime lasts, from the end of its last note', () => {
    expect(chimeDurationMs('leave')).toBe(940); // 0.12 s start, 0.02 s attack, 0.8 s fade
    expect(chimeDurationMs('leave')).toBeLessThan(chimeDurationMs('join'));
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
