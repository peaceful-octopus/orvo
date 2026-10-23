import {
  fromBase64Url,
  generateKeyPair,
  publicKeyFromSecret,
  toBase64Url,
  type KeyPair,
} from '@orvo/protocol';
import fs from 'node:fs';
import path from 'node:path';

export interface SigningKey extends KeyPair {
  kid: string;
}

/** Parses `SIGNING_KEY` as `<kid>:<base64url secret key>`, so several beacons can share one key. */
export function signingKeyFromEnv(value: string): SigningKey {
  const [kid, secret, ...rest] = value.split(':');
  if (!kid || !secret || rest.length > 0) throw new Error('SIGNING_KEY must look like <kid>:<base64url secret key>');
  const secretKey = fromBase64Url(secret);
  return { kid, secretKey, publicKey: publicKeyFromSecret(secretKey) };
}

/**
 * Uses `SIGNING_KEY` if set; otherwise loads the key from `dir/keys.json`, creating and persisting one
 * on first start (fine for one process, but several beacons must share a key through `SIGNING_KEY`).
 */
export function loadOrCreateSigningKey(dir: string, env: string | undefined = process.env.SIGNING_KEY, kid = 'local-1'): SigningKey {
  if (env) return signingKeyFromEnv(env);
  const file = path.join(dir, 'keys.json');
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { kid: string; publicKey: string; secretKey: string };
    return { kid: saved.kid, publicKey: fromBase64Url(saved.publicKey), secretKey: fromBase64Url(saved.secretKey) };
  }
  const pair = generateKeyPair();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ kid, publicKey: toBase64Url(pair.publicKey), secretKey: toBase64Url(pair.secretKey) }, null, 2),
    { mode: 0o600 },
  );
  return { kid, ...pair };
}
