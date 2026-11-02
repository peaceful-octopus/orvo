export type ChimeKind = 'join' | 'leave' | 'activity-start' | 'activity-end';

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

const NOTES: Record<ChimeKind, ChimeNote[]> = {
  // Two soft bell notes a fourth apart. Joining rises (G5 to C6), which sounds like a welcome; leaving falls
  // (C6 to G5) and is shorter and quieter, so it does not call attention to itself.
  join: [
    { freq: 783.99, start: 0, decay: 0.9, gain: 1 },
    { freq: 1046.5, start: 0.13, decay: 1.2, gain: 0.85 },
  ],
  leave: [
    { freq: 1046.5, start: 0, decay: 0.6, gain: 0.6 },
    { freq: 783.99, start: 0.12, decay: 0.8, gain: 0.5 },
  ],
  // Three notes, so they cannot be mistaken for someone arriving or leaving. Starting is a quick, bright rising
  // C major arpeggio (C6, E6, G6); ending is the same notes falling, slower and softer.
  'activity-start': [
    { freq: 1046.5, start: 0, decay: 0.55, gain: 0.8 },
    { freq: 1318.51, start: 0.09, decay: 0.55, gain: 0.8 },
    { freq: 1567.98, start: 0.18, decay: 0.95, gain: 0.85 },
  ],
  'activity-end': [
    { freq: 1567.98, start: 0, decay: 0.5, gain: 0.5 },
    { freq: 1318.51, start: 0.12, decay: 0.5, gain: 0.45 },
    { freq: 1046.5, start: 0.24, decay: 0.8, gain: 0.45 },
  ],
};

export const chimeNotes = (kind: ChimeKind): ChimeNote[] => NOTES[kind];

/** How long a chime sounds from start to end, in milliseconds. */
export const chimeDurationMs = (kind: ChimeKind): number =>
  Math.round(Math.max(...NOTES[kind].map((n) => n.start + ATTACK + n.decay)) * 1000);

/** The notes as the Android app's player reads them: "freq:start:decay:gain", separated by "|". */
export const encodeChime = (kind: ChimeKind): string => NOTES[kind].map((n) => [n.freq, n.start, n.decay, n.gain].join(':')).join('|');

/** Present only in the Android app, which plays chimes itself on the notification volume (see ChimePlayer.kt). */
interface NativeChime {
  playChime(notes: string, volume: number): boolean;
}
const nativePlayer = () => (window as unknown as { OrvoNative?: NativeChime }).OrvoNative;

let context: AudioContext | undefined;
function sharedContext(): AudioContext | undefined {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  context = new Ctor();
  return context;
}

let routedTo: string | undefined;
function route(ctx: AudioContext, outputId?: string): void {
  // Changing the output restarts the audio device, which drops samples, so it is done only when the choice changes.
  if (!outputId || outputId === routedTo) return;
  routedTo = outputId;
  void (ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(outputId).catch(() => {});
}

/**
 * Starts the audio output ahead of the first chime. Your own join chime is the first sound of the call, and starting the
 * output at that moment, while the call's video and audio processing is also starting, made it stutter.
 */
export function prepareChime(outputId?: string): void {
  try {
    if (nativePlayer()) return;
    const ctx = sharedContext();
    if (!ctx) return;
    route(ctx, outputId);
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    // Nothing to prepare where audio is unavailable.
  }
}

/**
 * Plays the chime for someone joining or leaving. `volume` is the speaker volume setting, 0 to 1, so the chime follows
 * what the person chose for other people's voices. `outputId` is the chosen speaker, where the browser can route to it.
 * It makes no sound, and no error, where audio is unavailable or the browser has not allowed it yet.
 */
export function playChime(kind: ChimeKind, volume: number, outputId?: string): void {
  try {
    if (volume <= 0) return;
    // In a call, a web view's sound follows the call volume, so the same chime came out at very different levels.
    if (nativePlayer()?.playChime(encodeChime(kind), Math.min(1, volume))) return;
    const ctx = sharedContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    route(ctx, outputId);
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
