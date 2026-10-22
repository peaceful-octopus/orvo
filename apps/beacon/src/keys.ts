import { fromBase64Url, generateKeyPair, toBase64Url, type KeyPair } from '@chillcall/protocol';
import fs from 'node:fs';
import path from 'node:path';

export interface SigningKey extends KeyPair {
  kid: string;
}

/** Loads the signing key from `dir/keys.json`, creating and persisting one on first start. */
export function loadOrCreateSigningKey(dir: string, kid = 'local-1'): SigningKey {
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
