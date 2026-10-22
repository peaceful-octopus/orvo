import { describe, expect, it } from 'vitest';
import { generateKeyPair } from './signing';
import {
  NonceCache,
  signJoinToken,
  signResumeToken,
  verifyJoinToken,
  verifyResumeToken,
  type JoinTokenPayload,
} from './token';

const now = 1_000_000;
const pair = generateKeyPair();
const keys = { k1: pair.publicKey };
const payload: JoinTokenPayload = { room: 'cozy-fox-abc123', nodeId: 'node-1', peerId: 'p1', exp: now + 60_000, nonce: 'nonce-0001' };
const checks = { keys, nodeId: 'node-1', now };

describe('join tokens', () => {
  it('accepts a valid token', () => {
    const result = verifyJoinToken(signJoinToken(payload, 'k1', pair.secretKey), checks);
    expect(result).toEqual({ ok: true, payload });
  });

  it('rejects an expired token', () => {
    const token = signJoinToken({ ...payload, exp: now - 1 }, 'k1', pair.secretKey);
    expect(verifyJoinToken(token, checks)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token for another node or room', () => {
    const token = signJoinToken(payload, 'k1', pair.secretKey);
    expect(verifyJoinToken(token, { ...checks, nodeId: 'node-2' })).toEqual({ ok: false, reason: 'wrong-node' });
    expect(verifyJoinToken(token, { ...checks, room: 'other-room-xyz' })).toEqual({ ok: false, reason: 'wrong-room' });
  });

  it('rejects a token signed by a different key', () => {
    const other = generateKeyPair();
    const token = signJoinToken(payload, 'k1', other.secretKey);
    expect(verifyJoinToken(token, checks)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects an unknown key id', () => {
    const token = signJoinToken(payload, 'k9', pair.secretKey);
    expect(verifyJoinToken(token, checks)).toEqual({ ok: false, reason: 'unknown-kid' });
  });

  it('rejects a tampered payload', () => {
    const [, signature] = signJoinToken(payload, 'k1', pair.secretKey).split('.');
    const forged = signJoinToken({ ...payload, peerId: 'someone-else' }, 'k1', pair.secretKey).split('.')[0];
    expect(verifyJoinToken(`${forged}.${signature}`, checks)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'abc', 'a.b.c', '!!!.???']) {
      expect(verifyJoinToken(bad, checks)).toEqual({ ok: false, reason: 'malformed' });
    }
  });
});

describe('NonceCache', () => {
  it('rejects a replayed nonce until it expires', () => {
    const cache = new NonceCache();
    expect(cache.checkAndAdd('n-00000001', now + 1000, now)).toBe(true);
    expect(cache.checkAndAdd('n-00000001', now + 1000, now + 500)).toBe(false);
    expect(cache.checkAndAdd('n-00000001', now + 3000, now + 2000)).toBe(true);
  });

  it('drops expired entries so memory stays bounded', () => {
    const cache = new NonceCache();
    for (let i = 0; i < 100; i++) cache.checkAndAdd(`nonce-${i}-xxxx`, now + 10, now);
    cache.checkAndAdd('fresh-nonce-1', now + 100, now + 50);
    expect(cache.size).toBe(1);
  });
});

describe('resume tokens', () => {
  const resume = { room: 'cozy-fox-abc123', peerId: 'p1', exp: now + 600_000 };

  it('verifies for the same room until expiry', () => {
    const token = signResumeToken(resume, 'k1', pair.secretKey);
    expect(verifyResumeToken(token, { keys, now, room: resume.room })).toEqual(resume);
    expect(verifyResumeToken(token, { keys, now: resume.exp + 1, room: resume.room })).toBeNull();
    expect(verifyResumeToken(token, { keys, now, room: 'other-room-xyz' })).toBeNull();
  });

  it('rejects a join token presented as a resume token and garbage', () => {
    const joinToken = signJoinToken(payload, 'k1', pair.secretKey);
    expect(verifyResumeToken(joinToken, { keys, now, room: payload.room })).toBeNull();
    expect(verifyResumeToken('junk', { keys, now, room: resume.room })).toBeNull();
  });
});
