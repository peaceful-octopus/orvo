import {
  generateKeyPair,
  signConfig,
  signJoinToken,
  type ClientConfig,
  type JoinTokenPayload,
  type KeyPair,
  type KeyRing,
} from '@orvo/protocol';

export interface TestKeys extends KeyPair {
  kid: string;
  keys: KeyRing;
}

export function testKeys(kid = 'test-1'): TestKeys {
  const pair = generateKeyPair();
  return { ...pair, kid, keys: { [kid]: pair.publicKey } };
}

/** A controllable clock for code that takes `now` as an input. */
export class FakeClock {
  constructor(public now = 1_700_000_000_000) {}
  advance(ms: number) {
    this.now += ms;
    return this.now;
  }
}

export function makeConfig(overrides: Partial<ClientConfig> = {}, now = 1_700_000_000_000): ClientConfig {
  return {
    version: 1,
    issuedAt: now,
    validUntil: now + 3600_000,
    minClientVersion: '0.0.0',
    minProtocol: 1,
    beaconUrls: ['http://localhost:8080'],
    limits: {
      maxRoomSize: 10,
      warnRoomSize: 6,
      videoTiers: [
        { maxPeers: 4, maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
        { maxPeers: 6, maxBitrate: 500_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
        { maxPeers: 10, maxBitrate: 250_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
      ],
    },
    features: {},
    ice: { stunUrls: ['stun:localhost:3478'] },
    regions: [{ id: 'local', name: 'Local' }],
    ...overrides,
  };
}

export function makeSignedConfig(keys: TestKeys, overrides: Partial<ClientConfig> = {}) {
  return signConfig(makeConfig(overrides), keys.kid, keys.secretKey);
}

export function makeJoinToken(keys: TestKeys, overrides: Partial<JoinTokenPayload> = {}, now = 1_700_000_000_000) {
  return signJoinToken(
    {
      room: 'test-room-abc123',
      nodeId: 'node-1',
      peerId: 'peer-1',
      exp: now + 60_000,
      nonce: `nonce-${Math.random().toString(36).slice(2, 10)}`,
      ...overrides,
    },
    keys.kid,
    keys.secretKey,
  );
}
