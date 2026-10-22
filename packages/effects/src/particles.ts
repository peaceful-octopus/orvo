export type Random = () => number;

export interface Particle {
  emoji: string;
  /** Where it starts, in canvas pixels. */
  x0: number;
  y0: number;
  /** Rise speed in pixels per millisecond (positive is up). */
  rise: number;
  /** Sideways wobble: amplitude in pixels, angular frequency in radians per millisecond, starting phase. */
  amplitude: number;
  frequency: number;
  phase: number;
  /** Full size in pixels. */
  size: number;
  bornAt: number;
  lifeMs: number;
}

export interface ParticleState {
  x: number;
  y: number;
  size: number;
  alpha: number;
  alive: boolean;
}

const FADE_IN_MS = 150;
const FADE_OUT_MS = 600;
const POP_MS = 220;

/** Overshoots slightly before settling, which makes things look like they pop in. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + c3 * x ** 3 + c1 * x ** 2;
}

/** A burst of one emoji rising from the lower part of the frame. */
export function spawnReaction(
  emoji: string,
  width: number,
  height: number,
  now: number,
  random: Random,
  count = 12,
): Particle[] {
  const base = Math.min(width, height);
  return Array.from({ length: count }, () => {
    const size = base * (0.14 + random() * 0.1);
    const lifeMs = 2200 + random() * 1000;
    return {
      emoji,
      x0: width * (0.12 + random() * 0.76),
      y0: height + size * 0.5,
      // Rises far enough to cross most of the frame before it is gone.
      rise: (height * (0.75 + random() * 0.35)) / lifeMs,
      amplitude: width * (0.015 + random() * 0.03),
      frequency: 0.002 + random() * 0.002,
      phase: random() * Math.PI * 2,
      size,
      // Stagger the burst so it reads as a stream rather than a block.
      bornAt: now + random() * 450,
      lifeMs,
    };
  });
}

export function particleState(p: Particle, now: number): ParticleState {
  const age = now - p.bornAt;
  if (age < 0) return { x: p.x0, y: p.y0, size: 0, alpha: 0, alive: true };
  if (age >= p.lifeMs) return { x: p.x0, y: p.y0, size: 0, alpha: 0, alive: false };

  const fadeIn = Math.min(1, age / FADE_IN_MS);
  const fadeOut = Math.min(1, (p.lifeMs - age) / FADE_OUT_MS);
  return {
    x: p.x0 + Math.sin(p.phase + age * p.frequency) * p.amplitude,
    y: p.y0 - p.rise * age,
    size: p.size * easeOutBack(age / POP_MS),
    alpha: Math.min(fadeIn, fadeOut),
    alive: true,
  };
}

/** True while any particle is still waiting to appear or is on screen. */
export function anyAlive(particles: Particle[], now: number): boolean {
  return particles.some((p) => now - p.bornAt < p.lifeMs);
}
