import { z } from 'zod';
import { fromBase64Url, signValue, toBase64Url, utf8, verifyValue, type KeyRing } from './signing';

export const JoinTokenPayload = z.object({
  room: z.string().min(1),
  nodeId: z.string().min(1),
  peerId: z.string().min(1),
  /** Expiry in epoch milliseconds. */
  exp: z.number().int(),
  nonce: z.string().min(8),
});
export type JoinTokenPayload = z.infer<typeof JoinTokenPayload>;

interface TokenEnvelope {
  kid: string;
  payload: JoinTokenPayload;
}

/** Token format: base64url(JSON {kid, payload}) + "." + base64url(signature over {kid, payload}). */
export function signJoinToken(payload: JoinTokenPayload, kid: string, secretKey: Uint8Array): string {
  const envelope: TokenEnvelope = { kid, payload };
  return `${toBase64Url(utf8.encode(JSON.stringify(envelope)))}.${signValue(envelope, secretKey)}`;
}

export type TokenFailure = 'malformed' | 'unknown-kid' | 'bad-signature' | 'expired' | 'wrong-node' | 'wrong-room';

export type TokenResult = { ok: true; payload: JoinTokenPayload } | { ok: false; reason: TokenFailure };

export interface TokenChecks {
  keys: KeyRing;
  /** The node verifying the token; tokens are only valid on the node that owns the room. */
  nodeId: string;
  now: number;
  /** When given, the token must be for this room. */
  room?: string;
}

export function verifyJoinToken(token: string, checks: TokenChecks): TokenResult {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return { ok: false, reason: 'malformed' };

  let envelope: TokenEnvelope;
  try {
    const parsed = z
      .object({ kid: z.string(), payload: JoinTokenPayload })
      .safeParse(JSON.parse(utf8.decode(fromBase64Url(body))));
    if (!parsed.success) return { ok: false, reason: 'malformed' };
    envelope = parsed.data;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const publicKey = checks.keys[envelope.kid];
  if (!publicKey) return { ok: false, reason: 'unknown-kid' };
  if (!verifyValue(envelope, signature, publicKey)) return { ok: false, reason: 'bad-signature' };

  const { payload } = envelope;
  if (payload.exp <= checks.now) return { ok: false, reason: 'expired' };
  if (payload.nodeId !== checks.nodeId) return { ok: false, reason: 'wrong-node' };
  if (checks.room !== undefined && payload.room !== checks.room) return { ok: false, reason: 'wrong-room' };
  return { ok: true, payload };
}

/** Remembers token nonces until they expire so a captured token cannot be replayed. */
export class NonceCache {
  private seen = new Map<string, number>();

  /** Returns false if the nonce was already used. */
  checkAndAdd(nonce: string, exp: number, now: number): boolean {
    for (const [key, expiry] of this.seen) if (expiry <= now) this.seen.delete(key);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, exp);
    return true;
  }

  get size() {
    return this.seen.size;
  }
}
