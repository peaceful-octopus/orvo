import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { turnCredentials } from './turn';

const pool = { urls: ['turn:turn.example.com:3478'], secret: 'shared-secret', ttlSeconds: 600 };

describe('turnCredentials', () => {
  it('builds a coturn REST username and HMAC password', () => {
    const creds = turnCredentials(pool, 'peer-1', 1_700_000_000_000);
    expect(creds.username).toBe('1700000600:peer-1');
    expect(creds.credential).toBe(createHmac('sha1', 'shared-secret').update('1700000600:peer-1').digest('base64'));
    expect(creds.urls).toEqual(pool.urls);
  });

  it('matches a known coturn test vector shape (base64 of a 20-byte digest)', () => {
    const credential = turnCredentials(pool, 'x', 0).credential!;
    expect(Buffer.from(credential, 'base64')).toHaveLength(20);
  });

  it('differs per label and per secret, and defaults the lifetime to an hour', () => {
    const a = turnCredentials(pool, 'a', 0);
    expect(turnCredentials(pool, 'b', 0).credential).not.toBe(a.credential);
    expect(turnCredentials({ ...pool, secret: 'other' }, 'a', 0).credential).not.toBe(a.credential);
    expect(turnCredentials({ urls: pool.urls, secret: 's' }, 'a', 0).username).toBe('3600:a');
  });
});
