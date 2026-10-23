import { makeConfig } from '@orvo/testkit';
import { describe, expect, it } from 'vitest';
import { dismissAnnouncement, updateRequired, visibleAnnouncement, type KeyValueStorage } from './configLogic';

function storage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('updateRequired', () => {
  it('is false when the build meets the minimum version and protocol', () => {
    expect(updateRequired(makeConfig({ minClientVersion: '1.0.0' }), '1.0.0')).toBe(false);
    expect(updateRequired(makeConfig({ minClientVersion: '1.0.0' }), '2.3.1')).toBe(false);
  });

  it('is true for an older build or a newer minimum protocol', () => {
    expect(updateRequired(makeConfig({ minClientVersion: '1.2.0' }), '1.1.9')).toBe(true);
    expect(updateRequired(makeConfig({ minProtocol: 99 }), '9.9.9')).toBe(true);
  });
});

describe('announcements', () => {
  const config = makeConfig({ announcement: { id: 'a1', text: 'Maintenance on Friday.' } });

  it('shows an announcement until it is dismissed, and again when a new one has a new id', () => {
    const s = storage();
    expect(visibleAnnouncement(config, s)).toEqual({ id: 'a1', text: 'Maintenance on Friday.' });

    dismissAnnouncement('a1', s);
    expect(visibleAnnouncement(config, s)).toBeUndefined();
    expect(visibleAnnouncement(makeConfig({ announcement: { id: 'a2', text: 'New.' } }), s)).toMatchObject({ id: 'a2' });
  });

  it('shows nothing when the config has no announcement', () => {
    expect(visibleAnnouncement(makeConfig(), storage())).toBeUndefined();
  });

  it('copes with missing or broken storage', () => {
    expect(visibleAnnouncement(config, undefined)).toMatchObject({ id: 'a1' });
    const broken: KeyValueStorage = { getItem: () => '{not json', setItem: () => { throw new Error('full'); } };
    expect(visibleAnnouncement(config, broken)).toMatchObject({ id: 'a1' });
    expect(() => dismissAnnouncement('a1', broken)).not.toThrow();
  });

  it('keeps only the most recent dismissals', () => {
    const s = storage();
    for (let i = 0; i < 30; i++) dismissAnnouncement(`n${i}`, s);
    expect(visibleAnnouncement(makeConfig({ announcement: { id: 'n0', text: 'old' } }), s)).toBeDefined();
    expect(visibleAnnouncement(makeConfig({ announcement: { id: 'n29', text: 'new' } }), s)).toBeUndefined();
  });
});
