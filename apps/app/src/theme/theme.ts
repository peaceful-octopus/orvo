import { useSyncExternalStore } from 'react';
import { useSettings } from '../settingsStore';
import { DEFAULT_PALETTE, PALETTES, type Mode, type Tokens } from './palettes';

export type ModePreference = 'system' | Mode;

export function resolveMode(preference: ModePreference, systemPrefersDark: boolean): Mode {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** `accentHover` becomes `--accent-hover`. */
const cssName = (role: string) => `--${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Documents that show the interface: the page itself, plus any Picture-in-Picture window that is open. */
const targets = new Set<Document>();
let current: { palette: string; mode: Mode } = { palette: DEFAULT_PALETTE, mode: 'dark' };
const listeners = new Set<() => void>();

/** The palette and mode in use now, for components that draw with the palette's colours themselves. Updates as they change. */
export function useCurrentTheme(): { tokens: Tokens; mode: Mode } {
  const now = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => current,
  );
  return { tokens: (PALETTES[now.palette] ?? PALETTES[DEFAULT_PALETTE]!)[now.mode], mode: now.mode };
}

function paint(doc: Document) {
  const palette = PALETTES[current.palette] ?? PALETTES[DEFAULT_PALETTE]!;
  const tokens = palette[current.mode];
  const root = doc.documentElement;
  for (const [role, value] of Object.entries(tokens) as [keyof Tokens, string][]) root.style.setProperty(cssName(role), value);
  root.dataset.palette = current.palette;
  root.dataset.mode = current.mode;
  root.style.colorScheme = current.mode;
}

/** Shows `doc` in the current palette and keeps it in step as the palette changes. */
export function registerThemeTarget(doc: Document): () => void {
  targets.add(doc);
  paint(doc);
  return () => void targets.delete(doc);
}

function apply() {
  const { palette, mode } = useSettings.getState();
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  current = { palette: palette in PALETTES ? palette : DEFAULT_PALETTE, mode: resolveMode(mode, dark) };
  for (const doc of targets) paint(doc);
  for (const listener of listeners) listener();
}

/**
 * Applies the chosen palette and light or dark mode, and follows changes made in Settings, changes to the system's
 * light or dark setting, and changes made in another window of the app (the floating controls are a separate window).
 */
export function startTheme() {
  targets.add(document);
  apply();
  useSettings.subscribe(apply);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', apply);
  // Only the look follows other windows. Other settings, such as the name, belong to each window's own call.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'orvo:settings' || !e.newValue) return;
    try {
      const { palette, mode } = (JSON.parse(e.newValue) as { state?: { palette?: string; mode?: ModePreference } }).state ?? {};
      const now = useSettings.getState();
      // Writing settings triggers this event in every other window, so only act on a real change or two windows
      // holding different names would keep rewriting each other's storage.
      if ((palette && palette !== now.palette) || (mode && mode !== now.mode)) {
        useSettings.setState({ ...(palette ? { palette } : {}), ...(mode ? { mode } : {}) });
      }
    } catch {
      // A value we cannot read is ignored.
    }
  });
}
