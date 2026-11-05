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

/**
 * The picture a camera is asked for. With no size given, browsers open a webcam at 640 x 480, which is all the call could
 * send however much bandwidth there was. These are preferences (`ideal`), so a camera that cannot do 1280 x 720 at 30
 * frames per second opens at the closest it can.
 */
export const CAMERA_PREFERENCE = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } as const;

/** Constraint that asks for one camera, or the default one, at the preferred size. */
export function cameraConstraint(id: string): MediaTrackConstraints {
  return id ? { deviceId: { exact: id }, ...CAMERA_PREFERENCE } : { ...CAMERA_PREFERENCE };
}

type OpenStream = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/**
 * Opens a device, a camera at the preferred size first. If that fails for any reason other than the person refusing access
 * (some cameras cannot be opened in a given mode), it is tried again with no size asked, which is what the app did before.
 */
export async function openDevice(open: OpenStream, kind: 'audioinput' | 'videoinput', id: string): Promise<MediaStream> {
  const key = kind === 'audioinput' ? 'audio' : 'video';
  const attempts = kind === 'videoinput' ? [cameraConstraint(id), deviceConstraint(id)] : [deviceConstraint(id)];
  let failure: unknown;
  for (const constraint of attempts) {
    try {
      return await open({ [key]: constraint });
    } catch (err) {
      failure = err;
      const name = (err as { name?: string } | undefined)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') break; // asking again would not change the answer
    }
  }
  throw failure;
}

/** Resets any choice whose device is no longer present (unplugged) to the system default. */
export function validSelection(selection: DeviceSelection, lists: DeviceLists): DeviceSelection {
  const next = { ...selection };
  for (const kind of DEVICE_KINDS) {
    if (next[kind] && !lists[kind].some((o) => o.id === next[kind])) next[kind] = '';
  }
  return next;
}

const KEY = 'orvo:devices';

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
