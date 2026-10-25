import { create } from 'zustand';

/** What the desktop shell's updater plugin offers; narrowed to what is used so tests can stand in for it. */
export interface PendingUpdate {
  version: string;
  downloadAndInstall(): Promise<void>;
}

export interface UpdaterDeps {
  check(): Promise<PendingUpdate | null>;
  relaunch(): Promise<void>;
}

export type UpdaterStatus = 'idle' | 'available' | 'installing' | 'failed';

export interface UpdaterState {
  status: UpdaterStatus;
  /** The version on offer, once there is one. */
  version?: string;
  /** Looks for a newer version; a check that cannot reach the update server is not an error worth showing. */
  check(): Promise<void>;
  /** Downloads and installs the offered version, then restarts the app. */
  install(): Promise<void>;
}

/** The store behind the update banner. The desktop app passes the Tauri plugins in; tests pass fakes. */
export function createUpdater(deps: UpdaterDeps) {
  let pending: PendingUpdate | undefined;

  return create<UpdaterState>((set, get) => ({
    status: 'idle',

    async check() {
      if (get().status === 'installing') return;
      try {
        const update = await deps.check();
        if (!update) return;
        pending = update;
        set({ status: 'available', version: update.version });
      } catch {
        // No update server, no network, or a build with no update address: carry on with this version.
      }
    },

    async install() {
      if (!pending || get().status === 'installing') return;
      set({ status: 'installing' });
      try {
        await pending.downloadAndInstall();
        await deps.relaunch();
      } catch {
        set({ status: 'failed' });
      }
    },
  }));
}

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const useUpdater = createUpdater({
  async check() {
    const { check } = await import('@tauri-apps/plugin-updater');
    return check();
  },
  async relaunch() {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },
});

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Desktop app only: look for an update now and every few hours. The development build has nowhere to look. */
export function startUpdateChecks() {
  if (!inTauri() || import.meta.env.DEV) return;
  void useUpdater.getState().check();
  setInterval(() => void useUpdater.getState().check(), CHECK_EVERY_MS);
}
