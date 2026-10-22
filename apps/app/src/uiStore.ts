import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutMode } from './float/layouts';

interface UiState {
  mode: LayoutMode;
  setMode(mode: LayoutMode): void;
}

export const useUi = create<UiState>()(
  persist((set) => ({ mode: 'campfire', setMode: (mode) => set({ mode }) }), { name: 'chillcall:ui' }),
);
