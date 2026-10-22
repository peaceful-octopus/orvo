import { describe, expect, it } from 'vitest';
import { parseDataMessage } from './datachannel';
import { MAX_FRAME_BYTES, encodeServerMessage, parseClientMessage, parseServerMessage } from './signaling';
import { canonicalize } from './signing';
import { compareVersions, isClientSupported } from './version';

describe('signaling frames', () => {
  it('parses valid client messages', () => {
    const join = parseClientMessage(JSON.stringify({ v: 1, type: 'join', token: 't', name: ' Ann ' }));
    expect(join).toEqual({ ok: true, message: { v: 1, type: 'join', token: 't', name: 'Ann' } });
    expect(parseClientMessage('{"v":1,"type":"ping"}').ok).toBe(true);
    expect(parseClientMessage('{"v":1,"type":"signal","to":"p2","payload":{"sdp":"x"}}').ok).toBe(true);
  });

  it('rejects malformed, unknown, wrong-version and oversize frames', () => {
    expect(parseClientMessage('not json')).toEqual({ ok: false, code: 'bad-request' });
    expect(parseClientMessage('{"v":1,"type":"nope"}').ok).toBe(false);
    expect(parseClientMessage('{"v":2,"type":"ping"}').ok).toBe(false);
    expect(parseClientMessage('{"v":1,"type":"join","token":"t","name":""}').ok).toBe(false);
    const huge = JSON.stringify({ v: 1, type: 'signal', to: 'p2', payload: 'x'.repeat(MAX_FRAME_BYTES) });
    expect(parseClientMessage(huge)).toEqual({ ok: false, code: 'bad-request' });
  });

  it('round-trips server messages', () => {
    const frame = encodeServerMessage({ type: 'welcome', peerId: 'p1', peers: [{ id: 'p2', name: 'Bo' }], status: 'ok', resumed: false });
    expect(parseServerMessage(frame).ok).toBe(true);
    expect(parseServerMessage(encodeServerMessage({ type: 'error', code: 'room-full' })).ok).toBe(true);
  });
});

describe('data-channel messages', () => {
  it('parses known messages and ignores unknown or newer ones', () => {
    expect(parseDataMessage('{"v":1,"kind":"state","audio":true,"video":false}')).toEqual({
      kind: 'state',
      audio: true,
      video: false,
    });
    expect(parseDataMessage('{"v":1,"kind":"reaction","emoji":"x"}')).toBeNull();
    expect(parseDataMessage('{"v":2,"kind":"state","audio":true,"video":true}')).toBeNull();
    expect(parseDataMessage('garbage')).toBeNull();
    expect(parseDataMessage(42)).toBeNull();
  });
});

describe('canonicalize', () => {
  it('is independent of key order and skips undefined', () => {
    expect(canonicalize({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      canonicalize({ a: { c: undefined, d: [2, { y: 2, z: 1 }] }, b: 1 }),
    );
  });
});

describe('versions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('gates on client version and protocol', () => {
    const required = { minClientVersion: '0.2.0', minProtocol: 1 };
    expect(isClientSupported({ version: '0.2.1', protocol: 1 }, required)).toBe(true);
    expect(isClientSupported({ version: '0.1.9', protocol: 1 }, required)).toBe(false);
    expect(isClientSupported({ version: '0.3.0', protocol: 0 }, required)).toBe(false);
  });
});
