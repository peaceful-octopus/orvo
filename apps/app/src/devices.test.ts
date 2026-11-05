import { describe, expect, it } from 'vitest';
import { CAMERA_PREFERENCE, cameraConstraint, deviceConstraint, noDevices, noSelection, openDevice, toDeviceLists, validSelection } from './devices';

describe('toDeviceLists', () => {
  const raw = [
    { kind: 'audioinput', deviceId: 'default', label: 'Default - Blue Yeti' },
    { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Blue Yeti' },
    { kind: 'audioinput', deviceId: 'a1', label: 'Blue Yeti' },
    { kind: 'audioinput', deviceId: 'a2', label: 'Laptop mic' },
    { kind: 'videoinput', deviceId: 'v1', label: 'FaceTime camera' },
    { kind: 'audiooutput', deviceId: 'o1', label: '' },
    { kind: 'audiooutput', deviceId: 'o2', label: '' },
  ];

  it('puts the system default first and names the device behind it', () => {
    const lists = toDeviceLists(raw);
    expect(lists.audioinput[0]).toEqual({ id: '', label: 'System default (Blue Yeti)' });
  });

  it('drops the communications duplicate and the default alias from the real devices', () => {
    expect(toDeviceLists(raw).audioinput.map((o) => o.id)).toEqual(['', 'a1', 'a2']);
  });

  it('always offers the system default, even when the browser lists none', () => {
    expect(toDeviceLists(raw).videoinput.map((o) => o.label)).toEqual(['System default', 'FaceTime camera']);
    expect(toDeviceLists([]).videoinput).toEqual([{ id: '', label: 'System default' }]);
  });

  it('numbers devices whose labels are hidden until permission is granted', () => {
    expect(toDeviceLists(raw).audiooutput.map((o) => o.label)).toEqual(['System default', 'Speaker 1', 'Speaker 2']);
  });

  it('ignores devices of other kinds', () => {
    expect(toDeviceLists([{ kind: 'something', deviceId: 'x', label: 'x' }]).audioinput).toHaveLength(1);
  });
});

describe('deviceConstraint', () => {
  it('asks for an exact device, or for any when none is chosen', () => {
    expect(deviceConstraint('abc')).toEqual({ deviceId: { exact: 'abc' } });
    expect(deviceConstraint('')).toBe(true);
  });
});

describe('cameraConstraint', () => {
  it('asks for 720p at 30 frames per second as a preference, with or without a chosen camera', () => {
    expect(cameraConstraint('')).toEqual(CAMERA_PREFERENCE);
    expect(cameraConstraint('cam1')).toEqual({ deviceId: { exact: 'cam1' }, ...CAMERA_PREFERENCE });
    // `ideal` never makes the request fail; a camera that cannot do it gives the closest it can.
    expect(JSON.stringify(CAMERA_PREFERENCE)).not.toMatch(/exact|min/);
  });
});

describe('openDevice', () => {
  const stream = {} as MediaStream;
  const refused = Object.assign(new Error('no'), { name: 'NotAllowedError' });
  const cannot = Object.assign(new Error('mode'), { name: 'OverconstrainedError' });

  it('opens a camera at the preferred size when it can', async () => {
    const asked: MediaStreamConstraints[] = [];
    const result = await openDevice(async (c) => (asked.push(c), stream), 'videoinput', 'cam1');
    expect(result).toBe(stream);
    expect(asked).toEqual([{ video: cameraConstraint('cam1') }]);
  });

  it('opens the camera with no size asked when it cannot be opened at the preferred one', async () => {
    const asked: MediaStreamConstraints[] = [];
    const result = await openDevice(
      async (c) => {
        asked.push(c);
        if (asked.length === 1) throw cannot;
        return stream;
      },
      'videoinput',
      '',
    );
    expect(result).toBe(stream);
    expect(asked).toEqual([{ video: cameraConstraint('') }, { video: true }]);
  });

  it('keeps the chosen camera in the second attempt', async () => {
    const asked: MediaStreamConstraints[] = [];
    await openDevice(async (c) => (asked.push(c), asked.length === 1 ? Promise.reject(cannot) : stream), 'videoinput', 'cam1');
    expect(asked[1]).toEqual({ video: { deviceId: { exact: 'cam1' } } });
  });

  it('does not ask again when the person refused access, and passes the error on', async () => {
    let calls = 0;
    await expect(openDevice(async () => (calls++, Promise.reject(refused)), 'videoinput', '')).rejects.toBe(refused);
    expect(calls).toBe(1);
  });

  it('passes the last error on when every attempt fails', async () => {
    await expect(openDevice(() => Promise.reject(cannot), 'videoinput', '')).rejects.toBe(cannot);
  });

  it('asks a microphone for nothing but the device', async () => {
    const asked: MediaStreamConstraints[] = [];
    await openDevice(async (c) => (asked.push(c), stream), 'audioinput', 'mic1');
    expect(asked).toEqual([{ audio: { deviceId: { exact: 'mic1' } } }]);
  });
});

describe('validSelection', () => {
  it('resets a choice whose device disappeared and keeps the others', () => {
    const lists = { ...noDevices(), audioinput: [{ id: '', label: 'd' }, { id: 'a1', label: 'x' }], videoinput: [{ id: '', label: 'd' }] };
    const chosen = { ...noSelection(), audioinput: 'a1', videoinput: 'gone' };
    expect(validSelection(chosen, lists)).toEqual({ audioinput: 'a1', videoinput: '', audiooutput: '' });
  });
});
