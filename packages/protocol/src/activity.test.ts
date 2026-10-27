import { describe, expect, it } from 'vitest';
import { ActivityManifest, MAX_ACTIVITY_DATA_BYTES, activityDataFits, parseGuestMessage } from './activity';

const manifest = {
  id: 'snake',
  name: 'Snake',
  description: 'Multiplayer snake',
  version: '1.0.0',
  apiVersion: 1,
  entry: '/activities/snake/index.html',
  minPlayers: 1,
  maxPlayers: 8,
  capabilities: [],
};

describe('ActivityManifest', () => {
  it('accepts a valid manifest', () => {
    expect(ActivityManifest.safeParse(manifest).success).toBe(true);
  });

  it('accepts an API version this client does not implement, so one such activity cannot invalidate the config', () => {
    expect(ActivityManifest.safeParse({ ...manifest, apiVersion: 2 }).success).toBe(true);
  });

  it.each([
    ['an entry outside /activities/', { entry: '/other/index.html' }],
    ['an absolute URL entry', { entry: 'https://evil.example.com/activities/x' }],
    ['path traversal', { entry: '/activities/../v1/keys' }],
    ['a protocol-relative segment', { entry: '/activities//evil.example.com' }],
    ['an id with uppercase or slashes', { id: 'Snake/../x' }],
    ['more players than a room holds', { maxPlayers: 11 }],
    ['min above max', { minPlayers: 5, maxPlayers: 2 }],
  ])('rejects %s', (_label, change) => {
    expect(ActivityManifest.safeParse({ ...manifest, ...change }).success).toBe(false);
  });
});

describe('activityDataFits', () => {
  it('accepts JSON within the limit and rejects the rest', () => {
    expect(activityDataFits({ a: 1 })).toBe(true);
    expect(activityDataFits('x'.repeat(MAX_ACTIVITY_DATA_BYTES))).toBe(false);
    expect(activityDataFits(undefined)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(activityDataFits(cyclic)).toBe(false);
  });
});

describe('parseGuestMessage', () => {
  it('parses ready, send and end', () => {
    expect(parseGuestMessage({ orvo: 1, type: 'ready' })).toEqual({ orvo: 1, type: 'ready' });
    expect(parseGuestMessage({ orvo: 1, type: 'send', data: { x: 1 } })).toEqual({ orvo: 1, type: 'send', data: { x: 1 } });
    expect(parseGuestMessage({ orvo: 1, type: 'end' })).toEqual({ orvo: 1, type: 'end' });
  });

  it('rejects other envelopes, unknown types, host-only types and oversize data', () => {
    expect(parseGuestMessage({ type: 'ready' })).toBeNull();
    expect(parseGuestMessage({ orvo: 2, type: 'ready' })).toBeNull();
    expect(parseGuestMessage({ orvo: 1, type: 'init' })).toBeNull();
    expect(parseGuestMessage({ orvo: 1, type: 'send', data: 'x'.repeat(MAX_ACTIVITY_DATA_BYTES) })).toBeNull();
    expect(parseGuestMessage('ready')).toBeNull();
    expect(parseGuestMessage(null)).toBeNull();
  });
});
