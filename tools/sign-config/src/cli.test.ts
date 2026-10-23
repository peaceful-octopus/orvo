import { ClientConfig, fromBase64Url, verifyConfig } from '@orvo/protocol';
import { makeConfig } from '@orvo/testkit';
import { describe, expect, it } from 'vitest';
import { run, type Io } from './cli';

const NOW = 1_700_000_000_000;

function harness(files: Record<string, string> = {}, env: Record<string, string> = {}) {
  const written: Record<string, string> = {};
  const lines: string[] = [];
  const io: Io = {
    readFile: (p) => {
      if (!(p in files)) throw new Error(`no such file ${p}`);
      return files[p]!;
    },
    writeFile: (p, c) => void (written[p] = c),
    env,
    now: () => NOW,
    out: (l) => void lines.push(l),
  };
  return { io, written, lines, text: () => lines.join('\n') };
}

function newKey() {
  const h = harness();
  expect(run(['keygen', '--kid', 'prod-1'], h.io)).toBe(0);
  return JSON.parse(h.text()) as { kid: string; publicKey: string; secretKey: string };
}

const full = makeConfig({}, NOW);
// A config file as an operator writes it: without the fields the tool fills in.
const unsigned: Partial<ClientConfig> = { ...full, version: undefined, issuedAt: undefined, validUntil: undefined };

describe('sign-config', () => {
  it('generates a key pair with the requested id', () => {
    const key = newKey();
    expect(key.kid).toBe('prod-1');
    expect(fromBase64Url(key.secretKey)).toHaveLength(32);
    expect(fromBase64Url(key.publicKey)).toHaveLength(32);
  });

  it('signs a config so that verify accepts it, filling in version and validity', () => {
    const key = newKey();
    const h = harness({ 'config.json': JSON.stringify(unsigned) });
    expect(run(['sign', 'config.json', '--key', `${key.kid}:${key.secretKey}`, '--out', 'signed.json', '--valid-days', '10'], h.io)).toBe(0);

    const signed = JSON.parse(h.written['signed.json']!);
    const result = verifyConfig(signed, { keys: { [key.kid]: fromBase64Url(key.publicKey) }, now: NOW, graceMs: 0 });
    expect(result).toMatchObject({ ok: true, config: { version: NOW / 1000, issuedAt: NOW, validUntil: NOW + 10 * 24 * 3600_000 } });

    const v = harness({ 'signed.json': h.written['signed.json']! });
    expect(run(['verify', 'signed.json', '--public', `${key.kid}:${key.publicKey}`], v.io)).toBe(0);
    expect(v.text()).toContain('OK: version');
  });

  it('keeps version and validity that the file already sets, and reads the key from $SIGNING_KEY', () => {
    const key = newKey();
    const h = harness(
      { 'config.json': JSON.stringify({ ...unsigned, version: 42, validUntil: NOW + 5 }) },
      { SIGNING_KEY: `${key.kid}:${key.secretKey}` },
    );
    expect(run(['sign', 'config.json'], h.io)).toBe(0);
    const signed = JSON.parse(h.text());
    expect(ClientConfig.parse(signed.payload)).toMatchObject({ version: 42, validUntil: NOW + 5 });
  });

  it('verify fails for the wrong key, a tampered file and a rollback', () => {
    const key = newKey();
    const other = newKey();
    const s = harness({ 'config.json': JSON.stringify(unsigned) });
    run(['sign', 'config.json', '--key', `${key.kid}:${key.secretKey}`], s.io);
    const signedText = s.text();

    const wrongKey = harness({ f: signedText });
    expect(run(['verify', 'f', '--public', `${key.kid}:${other.publicKey}`], wrongKey.io)).toBe(1);
    expect(wrongKey.text()).toContain('INVALID: bad-signature');

    const tampered = JSON.parse(signedText);
    tampered.payload.beaconUrls = ['https://evil.example.com'];
    const t = harness({ f: JSON.stringify(tampered) });
    expect(run(['verify', 'f', '--public', `${key.kid}:${key.publicKey}`], t.io)).toBe(1);

    const rollback = harness({ f: signedText });
    expect(run(['verify', 'f', '--public', `${key.kid}:${key.publicKey}`, '--min-version', String(NOW)], rollback.io)).toBe(1);
    expect(rollback.text()).toContain('INVALID: rollback');
  });

  it('explains bad input instead of throwing', () => {
    const key = newKey();
    const bad = harness({ 'config.json': JSON.stringify({ ...unsigned, beaconUrls: [] }) });
    expect(run(['sign', 'config.json', '--key', `${key.kid}:${key.secretKey}`], bad.io)).toBe(2);
    expect(bad.text()).toContain('invalid config');
    expect(bad.text()).toContain('beaconUrls');

    expect(run(['sign', 'config.json'], harness({ 'config.json': '{}' }).io)).toBe(2);
    expect(run(['sign'], harness().io)).toBe(2);
    expect(run(['sign', 'missing.json', '--key', 'bad'], harness().io)).toBe(2);
    expect(run(['bogus'], harness().io)).toBe(2);
    expect(run([], harness().io)).toBe(0);
  });
});
