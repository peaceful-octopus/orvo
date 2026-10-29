export type ChimeKind = 'join' | 'leave';

export interface ChimeNote {
  /** Hertz. */
  freq: number;
  /** Seconds after the chime starts. */
  start: number;
  /** Seconds the note takes to fade out. */
  decay: number;
  /** Peak level, 0 to 1, before the volume setting. */
  gain: number;
}

/** Peak level of the loudest note; the chimes stay well below speech. */
const MASTER = 0.18;
const ATTACK = 0.02;

/**
 * Two soft bell notes a fourth apart. Joining rises (G5 to C6), which sounds like a welcome; leaving falls (C6 to G5)
 * and is shorter and quieter, so it does not call attention to itself.
 */
export function chimeNotes(kind: ChimeKind): ChimeNote[] {
  return kind === 'join'
    ? [
        { freq: 783.99, start: 0, decay: 0.9, gain: 1 },
        { freq: 1046.5, start: 0.13, decay: 1.2, gain: 0.85 },
      ]
    : [
        { freq: 1046.5, start: 0, decay: 0.6, gain: 0.6 },
        { freq: 783.99, start: 0.12, decay: 0.8, gain: 0.5 },
      ];
}

let context: AudioContext | undefined;
function sharedContext(): AudioContext | undefined {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  context = new Ctor();
  return context;
}

/**
 * Plays the chime for someone joining or leaving. `volume` is the speaker volume setting, 0 to 1, so the chime follows
 * what the person chose for other people's voices. `outputId` is the chosen speaker, where the browser can route to it.
 * It makes no sound, and no error, where audio is unavailable or the browser has not allowed it yet.
 */
export function playChime(kind: ChimeKind, volume: number, outputId?: string): void {
  try {
    const ctx = sharedContext();
    if (!ctx || volume <= 0) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    if (outputId) void (ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(outputId).catch(() => {});
    const at = ctx.currentTime + 0.02;
    for (const note of chimeNotes(kind)) {
      const peak = Math.min(1, volume) * MASTER * note.gain;
      const begin = at + note.start;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, begin);
      gain.gain.linearRampToValueAtTime(peak, begin + ATTACK);
      gain.gain.exponentialRampToValueAtTime(0.0001, begin + ATTACK + note.decay);
      gain.connect(ctx.destination);
      // A pure tone plus a quiet octave above it gives a bell-like warmth without a harsh edge.
      for (const [ratio, level] of [
        [1, 1],
        [2, 0.18],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = note.freq * ratio;
        const part = ctx.createGain();
        part.gain.value = level;
        osc.connect(part).connect(gain);
        osc.start(begin);
        osc.stop(begin + ATTACK + note.decay + 0.05);
      }
    }
  } catch {
    // A missing chime is not worth interrupting a call for.
  }
}
