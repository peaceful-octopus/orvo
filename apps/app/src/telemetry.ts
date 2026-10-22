import { TelemetryClient } from '@chillcall/rtc';
import { telemetryAllowed } from './config';
import { useConfig } from './configStore';

let allowed = telemetryAllowed();

/** Anonymous connection statistics, sent to the user's own server; off when the user or the server config says so. */
export const telemetry = new TelemetryClient({
  beaconUrls: () => useConfig.getState().config.beaconUrls,
  enabled: () => allowed && useConfig.getState().config.features.telemetry !== false,
});

export function setTelemetryEnabled(enabled: boolean) {
  allowed = enabled;
}
