/**
 * Levels are the root mean square of samples between -1 and 1. Microphones differ a lot in how loud speech is, so the
 * thresholds follow the room's background level, with a floor under them so silence is never taken for speech.
 */
const ON_MIN = 0.005;
const OFF_MIN = 0.003;
/** Speaking starts when the level is this many times the background, and ends when it falls below `OFF_RATIO` times it. */
const ON_RATIO = 3;
const OFF_RATIO = 1.8;
/** The background level assumed before anything has been heard. */
const START_FLOOR = 0.003;
/** The background is the quietest reading in this many readings (about six seconds): speech has pauses, a hum does not. */
const FLOOR_READINGS = 75;
/** Loud for this many readings in a row before speaking starts, so a click or a bump does not count. */
const ON_READINGS = 2;
/** Quiet for this long before speaking stops, so the glow rides through the gaps between words. */
const HOLD_MS = 450;

/** Turns a stream of loudness readings into a steady yes or no for "is this person speaking". */
export class SpeakingGate {
  private recent: number[] = Array.from({ length: FLOOR_READINGS }, () => START_FLOOR);
  private loud = 0;
  private lastLoudAt = -Infinity;
  private on = false;

  /** `level` is the latest reading and `now` the time in milliseconds; returns whether the person is speaking. */
  push(level: number, now: number): boolean {
    this.recent.shift();
    this.recent.push(level);
    const floor = Math.min(...this.recent);

    const threshold = this.on ? Math.max(OFF_MIN, floor * OFF_RATIO) : Math.max(ON_MIN, floor * ON_RATIO);
    if (level >= threshold) {
      this.loud++;
      this.lastLoudAt = now;
      if (this.loud >= ON_READINGS) this.on = true;
    } else {
      this.loud = 0;
      if (this.on && now - this.lastLoudAt > HOLD_MS) this.on = false;
    }
    return this.on;
  }
}

/** Root mean square of 8-bit time-domain samples from an analyser (128 is silence). */
export function levelOf(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) {
    const x = (s - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / samples.length);
}
