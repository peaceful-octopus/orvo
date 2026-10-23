import type { ClientConfig } from '@chillcall/protocol';
import { defaultConfig, type ConfigSource } from '@chillcall/rtc';
import { create } from 'zustand';
import { getServerUrl, loadClientConfig } from './config';

interface ConfigState {
  config: ClientConfig;
  source: ConfigSource;
  loaded: boolean;
  /** Loads the signed config for the current server; built-in defaults apply until it arrives. */
  refresh(): Promise<void>;
}

export const useConfig = create<ConfigState>((set) => ({
  config: defaultConfig([getServerUrl()]),
  source: 'default',
  loaded: false,
  async refresh() {
    set({ loaded: false });
    const { config, source } = await loadClientConfig();
    set({ config, source, loaded: true });
  },
}));
