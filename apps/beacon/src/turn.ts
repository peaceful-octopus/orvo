import type { IceServer } from '@chillcall/protocol';
import { createHmac } from 'node:crypto';

/** A coturn pool using REST-style shared-secret auth (`use-auth-secret`). */
export interface TurnPool {
  urls: string[];
  secret: string;
  /** How long issued credentials stay valid. */
  ttlSeconds?: number;
}

export const DEFAULT_TURN_TTL_SECONDS = 3600;

/**
 * Time-limited TURN credentials in the coturn REST format: the username is `<expiry>:<label>` and the
 * password is the base64 HMAC-SHA1 of the username under the pool's secret. Credentials stop working
 * on their own after `ttlSeconds`, so they need no revocation.
 */
export function turnCredentials(pool: TurnPool, label: string, nowMs: number): IceServer {
  const expiry = Math.floor(nowMs / 1000) + (pool.ttlSeconds ?? DEFAULT_TURN_TTL_SECONDS);
  const username = `${expiry}:${label}`;
  return {
    urls: pool.urls,
    username,
    credential: createHmac('sha1', pool.secret).update(username).digest('base64'),
  };
}
