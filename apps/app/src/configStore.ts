import type { ClientConfig } from '@orvo/protocol';
import { defaultConfig, type ConfigSource } from '@orvo/rtc';
import { create } from 'zustand';
import { getServerUrl, loadClientConfig } from './config';

interface ConfigState {
  config: ClientConfig;
  source: ConfigSource;
  loaded: boolean;
  /** Loads the signed config for the current server; built-in defaults apply until it arrives. */
  refresh(): Promise<void>;
  /** Fetches the config again if the one in hand is old, without any loading state, so an open page follows the server's changes. */
  revalidate(): Promise<void>;
}

/** How old the config may get before an open page asks the server again. */
export const CONFIG_MAX_AGE_MS = 5 * 60_000;

export const useConfig = create<ConfigState>((set) => ({
  config: defaultConfig([getServerUrl()]),
  source: 'default',
  loaded: false,
  async refresh() {
    set({ loaded: false });
    const { config, source } = await loadClientConfig();
    set({ config, source, loaded: true });
  },
  async revalidate() {
    const { config, source } = await loadClientConfig({ maxAgeMs: CONFIG_MAX_AGE_MS });
    // A server that cannot be reached right now leaves what was loaded from it in place.
    if (source === 'network') set({ config, source, loaded: true });
  },
}));
