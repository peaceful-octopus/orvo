import { create } from 'zustand';

export type ToastKind = 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Most toasts shown at once; older ones make way for newer. */
export const MAX_TOASTS = 3;
const SHOW_MS: Record<ToastKind, number> = { error: 7000, info: 5000 };

interface ToastState {
  toasts: Toast[];
  show(kind: ToastKind, text: string): void;
  dismiss(id: number): void;
}

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],

  show(kind, text) {
    // The same message again refreshes the one on screen instead of piling up.
    const existing = get().toasts.find((t) => t.kind === kind && t.text === text);
    if (existing) {
      clearTimeout(timers.get(existing.id));
      timers.set(existing.id, setTimeout(() => get().dismiss(existing.id), SHOW_MS[kind]));
      return;
    }
    const toast: Toast = { id: nextId++, kind, text };
    const kept = [...get().toasts, toast];
    for (const dropped of kept.slice(0, Math.max(0, kept.length - MAX_TOASTS))) clearTimeout(timers.get(dropped.id));
    set({ toasts: kept.slice(-MAX_TOASTS) });
    timers.set(toast.id, setTimeout(() => get().dismiss(toast.id), SHOW_MS[kind]));
  },

  dismiss(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** For code outside React: `toast.error('...')`. */
export const toast = {
  error: (text: string) => useToasts.getState().show('error', text),
  info: (text: string) => useToasts.getState().show('info', text),
};
