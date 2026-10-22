import { verifyConfig, verifyJoinToken } from '@chillcall/protocol';
import { describe, expect, it } from 'vitest';
import { FakeClock, makeJoinToken, makeSignedConfig, testKeys } from './index';

describe('testkit factories', () => {
  const keys = testKeys();
  const clock = new FakeClock();

  it('produces a config that verifies', () => {
    const result = verifyConfig(makeSignedConfig(keys), { keys: keys.keys, now: clock.now, graceMs: 0 });
    expect(result.ok).toBe(true);
  });

  it('produces a token that verifies until the clock passes expiry', () => {
    const token = makeJoinToken(keys);
    const checks = { keys: keys.keys, nodeId: 'node-1', now: clock.now };
    expect(verifyJoinToken(token, checks).ok).toBe(true);
    expect(verifyJoinToken(token, { ...checks, now: clock.advance(61_000) })).toEqual({ ok: false, reason: 'expired' });
  });
});
