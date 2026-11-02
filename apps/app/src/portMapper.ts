import type { PortMapper, PortMapping } from '@orvo/rtc';
import { inTauri } from './platform';

const invoke = async <T>(command: string, args: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(command, args);

/** The app's router port mapping (UPnP, PCP or NAT-PMP), done natively; a browser has none. */
const nativePortMapper: PortMapper = {
  map: (localIp, localPort) => invoke<PortMapping>('map_udp_port', { localIp, localPort }),
  unmap: (localIp, localPort) => invoke<void>('unmap_udp_port', { localIp, localPort }),
};

/** What a call uses to have the router forward its ports, if anything: only in the app, and only while the setting is on. */
export function portMapperFor(enabled: boolean): PortMapper | undefined {
  return inTauri && enabled ? nativePortMapper : undefined;
}
