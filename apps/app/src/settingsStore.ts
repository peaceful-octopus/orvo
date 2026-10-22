import { create } from 'zustand';
import { DEFAULT_PALETTE } from './theme/palettes';
import type { ModePreference } from './theme/theme';
import { persist } from 'zustand/middleware';

export type StartView = 'windowed' | 'floating';

export interface Settings {
  /** How you appear to others; can be changed during a call. */
  name: string;
  /** Whether a call opens in the full window or as floating bubbles. */
  startView: StartView;
  noise: {
    enabled: boolean;
    /** 0 to 100: how much the filter is allowed to turn background sound down. */
    strength: number;
  };
  /** Colour palette, and whether it follows the system's light or dark setting. */
  palette: string;
  mode: ModePreference;
  /** Microphone volume as a percentage of the original level; above 100 amplifies. */
  micVolume: number;
  /** Volume of other people, 0 to 100. */
  speakerVolume: number;
}

interface SettingsState extends Settings {
  setName(name: string): void;
  setStartView(view: StartView): void;
  setNoise(patch: Partial<Settings['noise']>): void;
  setPalette(palette: string): void;
  setMode(mode: ModePreference): void;
  setMicVolume(percent: number): void;
  setSpeakerVolume(percent: number): void;
}

export const DEFAULT_NOISE_STRENGTH = 60;
export const MAX_MIC_VOLUME = 200;

/** The name used before settings existed was stored on its own. */
function legacyName(): string {
  try {
    return localStorage.getItem('chillcall:name') ?? '';
  } catch {
    return '';
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      name: legacyName(),
      startView: 'windowed',
      noise: { enabled: true, strength: DEFAULT_NOISE_STRENGTH },
      palette: DEFAULT_PALETTE,
      mode: 'system',
      micVolume: 100,
      speakerVolume: 100,
      setName: (name) => set({ name }),
      setStartView: (startView) => set({ startView }),
      setNoise: (patch) => set((s) => ({ noise: { ...s.noise, ...patch } })),
      setPalette: (palette) => set({ palette }),
      setMode: (mode) => set({ mode }),
      setMicVolume: (micVolume) => set({ micVolume }),
      setSpeakerVolume: (speakerVolume) => set({ speakerVolume }),
    }),
    {
      name: 'chillcall:settings',
      // Merge nested noise settings so a saved older shape keeps the new defaults.
      merge: (saved, current) => {
        const stored = (saved ?? {}) as Partial<Settings>;
        return { ...current, ...stored, noise: { ...current.noise, ...stored.noise } };
      },
    },
  ),
);
