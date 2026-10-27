import { describe, expect, it } from 'vitest';
import { signConfig, verifyConfig, type ClientConfig } from './config';
import { generateKeyPair } from './signing';

const now = 10_000_000;
const pair = generateKeyPair();
const keys = { k1: pair.publicKey };
const graceMs = 7 * 24 * 3600_000;

const config: ClientConfig = {
  version: 5,
  issuedAt: now - 1000,
  validUntil: now + 3600_000,
  minClientVersion: '0.1.0',
  minProtocol: 1,
  beaconUrls: ['https://beacon.example.com', 'https://beacon.example.net'],
  limits: {
    maxRoomSize: 10,
    warnRoomSize: 6,
    videoTiers: [{ maxPeers: 4, maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 }],
  },
  features: { turn: false },
  ice: { stunUrls: ['stun:stun.example.com:3478'] },
  regions: [{ id: 'us', name: 'US' }],
};

const check = (signed: unknown, extra = {}) => verifyConfig(signed, { keys, now, graceMs, ...extra });

describe('verifyConfig', () => {
  it('accepts a valid signed config', () => {
    expect(check(signConfig(config, 'k1', pair.secretKey))).toEqual({ ok: true, config });
  });

  it('carries activities in the signed payload, and an edited list breaks the signature', () => {
    const activity = {
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
    const withActivities = { ...config, activities: [activity] };
    const signed = signConfig(withActivities, 'k1', pair.secretKey);
    expect(check(signed)).toEqual({ ok: true, config: withActivities });
    const tampered = { ...signed, payload: { ...withActivities, activities: [{ ...activity, entry: '/activities/evil/index.html' }] } };
    expect(check(tampered)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a signed config whose activity entry leaves /activities/', () => {
    const bad = { ...config, activities: [{ id: 'x', name: 'X', description: '', version: '1', apiVersion: 1, entry: 'https://evil.example.com', minPlayers: 1, maxPlayers: 2, capabilities: [] }] };
    expect(check(signConfig(bad as ClientConfig, 'k1', pair.secretKey))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a tampered payload', () => {
    const signed = signConfig(config, 'k1', pair.secretKey);
    const tampered = { ...signed, payload: { ...config, beaconUrls: ['https://evil.example.com'] } };
    expect(check(tampered)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects an unknown key id and a wrong key', () => {
    expect(check(signConfig(config, 'k2', pair.secretKey))).toEqual({ ok: false, reason: 'unknown-kid' });
    expect(check(signConfig(config, 'k1', generateKeyPair().secretKey))).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a rollback to an older version but accepts the same or newer', () => {
    const signed = signConfig(config, 'k1', pair.secretKey);
    expect(check(signed, { cachedVersion: 6 })).toEqual({ ok: false, reason: 'rollback' });
    expect(check(signed, { cachedVersion: 5 }).ok).toBe(true);
    expect(check(signed, { cachedVersion: 4 }).ok).toBe(true);
  });

  it('honors an expired config only within the grace period', () => {
    const signed = signConfig({ ...config, validUntil: now - 1000 }, 'k1', pair.secretKey);
    expect(check(signed).ok).toBe(true);
    expect(verifyConfig(signed, { keys, now: now + graceMs, graceMs })).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed input and payloads that fail the schema', () => {
    expect(check(null)).toEqual({ ok: false, reason: 'malformed' });
    expect(check({ kid: 'k1' })).toEqual({ ok: false, reason: 'malformed' });
    const bad = signConfig({ ...config, beaconUrls: [] }, 'k1', pair.secretKey);
    expect(check(bad)).toEqual({ ok: false, reason: 'malformed' });
  });
});
