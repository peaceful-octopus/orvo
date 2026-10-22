import { describe, expect, it } from 'vitest';
import { deviceConstraint, noDevices, noSelection, toDeviceLists, validSelection } from './devices';

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

describe('validSelection', () => {
  it('resets a choice whose device disappeared and keeps the others', () => {
    const lists = { ...noDevices(), audioinput: [{ id: '', label: 'd' }, { id: 'a1', label: 'x' }], videoinput: [{ id: '', label: 'd' }] };
    const chosen = { ...noSelection(), audioinput: 'a1', videoinput: 'gone' };
    expect(validSelection(chosen, lists)).toEqual({ audioinput: 'a1', videoinput: '', audiooutput: '' });
  });
});
