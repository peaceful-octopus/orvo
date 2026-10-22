import { ed25519 } from '@noble/curves/ed25519.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** JSON with object keys sorted, so the same value always signs to the same bytes. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Trusted verification keys by key id, so keys can be rotated without shipping a new app. */
export type KeyRing = Record<string, Uint8Array>;

export function generateKeyPair(): KeyPair {
  return ed25519.keygen();
}

export function signValue(value: unknown, secretKey: Uint8Array): string {
  return toBase64Url(ed25519.sign(encoder.encode(canonicalize(value)), secretKey));
}

export function verifyValue(value: unknown, signature: string, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(fromBase64Url(signature), encoder.encode(canonicalize(value)), publicKey);
  } catch {
    return false;
  }
}

export const utf8 = { encode: (s: string) => encoder.encode(s), decode: (b: Uint8Array) => decoder.decode(b) };
