import { describe, expect, it } from 'vitest';
import { levelOf, SpeakingGate } from './speaking';

const quiet = 0.001;
const voice = 0.08;

describe('levelOf', () => {
  it('reads silence as zero', () => {
    expect(levelOf(new Uint8Array(512).fill(128))).toBe(0);
    expect(levelOf(new Uint8Array())).toBe(0);
  });

  it('reads a full-scale square wave as one', () => {
    expect(levelOf(Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 255 : 1)))).toBeGreaterThan(0.99);
  });
});

describe('SpeakingGate', () => {
  it('starts after two loud readings in a row, not one', () => {
    const gate = new SpeakingGate();
    expect(gate.push(voice, 0)).toBe(false);
    expect(gate.push(voice, 80)).toBe(true);
  });

  it('ignores a single bump', () => {
    const gate = new SpeakingGate();
    expect(gate.push(voice, 0)).toBe(false);
    expect(gate.push(quiet, 80)).toBe(false);
    expect(gate.push(voice, 160)).toBe(false);
  });

  it('rides through short pauses and stops after a longer one', () => {
    const gate = new SpeakingGate();
    gate.push(voice, 0);
    gate.push(voice, 80);
    expect(gate.push(quiet, 300)).toBe(true);
    expect(gate.push(quiet, 500)).toBe(true);
    expect(gate.push(quiet, 600)).toBe(false);
  });

  it('never takes silence for speech', () => {
    const gate = new SpeakingGate();
    for (let t = 0; t < 10_000; t += 80) expect(gate.push(0.002, t)).toBe(false);
  });

  it('hears a quiet microphone against a quiet room', () => {
    const gate = new SpeakingGate();
    for (let t = 0; t < 2000; t += 80) gate.push(0.001, t);
    expect(gate.push(0.007, 2000)).toBe(false);
    expect(gate.push(0.007, 2080)).toBe(true);
  });

  it('needs more than the room noise in a noisy room', () => {
    const gate = new SpeakingGate();
    for (let t = 0; t < 20_000; t += 80) gate.push(0.02, t); // a constant hum settles into the background
    expect(gate.push(0.025, 20_000)).toBe(false);
    expect(gate.push(0.025, 20_080)).toBe(false);
    expect(gate.push(0.2, 20_160)).toBe(false);
    expect(gate.push(0.2, 20_240)).toBe(true);
  });

  it('keeps a quiet syllable going once speaking has started', () => {
    const gate = new SpeakingGate();
    gate.push(voice, 0);
    gate.push(voice, 80);
    expect(gate.push(0.015, 160)).toBe(true);
    expect(gate.push(0.015, 600)).toBe(true);
  });
});
