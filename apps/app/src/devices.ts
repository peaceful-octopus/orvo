export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export interface DeviceOption {
  /** The browser's device id; empty means "whatever the system default is". */
  id: string;
  label: string;
}

export type DeviceLists = Record<DeviceKind, DeviceOption[]>;
/** The chosen device id per kind; empty means the system default. */
export type DeviceSelection = Record<DeviceKind, string>;

export const DEVICE_KINDS: DeviceKind[] = ['audioinput', 'videoinput', 'audiooutput'];

export const SYSTEM_DEFAULT = 'System default';

export const noDevices = (): DeviceLists => ({ audioinput: [], videoinput: [], audiooutput: [] });
export const noSelection = (): DeviceSelection => ({ audioinput: '', videoinput: '', audiooutput: '' });

const FALLBACK_NAME: Record<DeviceKind, string> = { audioinput: 'Microphone', videoinput: 'Camera', audiooutput: 'Speaker' };

interface RawDevice {
  kind: string;
  deviceId: string;
  label: string;
}

/**
 * Turns the browser's device list into options per kind. The first option of each kind is always the system default
 * (Chromium also lists a "default" entry that points at the same device; it becomes this option, and its
 * "communications" twin is dropped). Devices without a label, which the browser hides until permission is granted,
 * get a numbered name.
 */
export function toDeviceLists(devices: RawDevice[]): DeviceLists {
  const lists = noDevices();
  for (const kind of DEVICE_KINDS) {
    const ofKind = devices.filter((d) => d.kind === kind);
    const systemDefault = ofKind.find((d) => d.deviceId === 'default');
    const named = systemDefault?.label.replace(/^default\s*-\s*/i, '');
    lists[kind].push({ id: '', label: named ? `${SYSTEM_DEFAULT} (${named})` : SYSTEM_DEFAULT });
    let n = 0;
    for (const d of ofKind) {
      if (d.deviceId === 'default' || d.deviceId === 'communications' || !d.deviceId) continue;
      n++;
      lists[kind].push({ id: d.deviceId, label: d.label || `${FALLBACK_NAME[kind]} ${n}` });
    }
  }
  return lists;
}

/** Constraint that asks for one device, or for the default when no id is chosen. */
export function deviceConstraint(id: string): true | { deviceId: { exact: string } } {
  return id ? { deviceId: { exact: id } } : true;
}

/** Resets any choice whose device is no longer present (unplugged) to the system default. */
export function validSelection(selection: DeviceSelection, lists: DeviceLists): DeviceSelection {
  const next = { ...selection };
  for (const kind of DEVICE_KINDS) {
    if (next[kind] && !lists[kind].some((o) => o.id === next[kind])) next[kind] = '';
  }
  return next;
}

const KEY = 'chillcall:devices';

export function loadSelection(): DeviceSelection {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DeviceSelection>;
    const selection = noSelection();
    for (const kind of DEVICE_KINDS) if (typeof saved[kind] === 'string') selection[kind] = saved[kind];
    return selection;
  } catch {
    return noSelection();
  }
}

export function saveSelection(selection: DeviceSelection) {
  try {
    localStorage.setItem(KEY, JSON.stringify(selection));
  } catch {
    // Not remembering the choice is harmless.
  }
}

/** Choosing a speaker needs setSinkId, which Chromium has and Firefox and Safari do not. */
export function canSelectOutput(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}
