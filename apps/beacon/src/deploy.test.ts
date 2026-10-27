import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the safety settings of the shipped coturn configs, since a relay without them is an open proxy into
// the operator's private network. These read the files only; they do not start coturn.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../deploy/turn');
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

const pools = { full: read('turnserver.full.conf'), lite: read('turnserver.lite.conf') };
const settings = (conf: string) =>
  conf
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
const value = (conf: string, key: string) => settings(conf).find((l) => l.startsWith(`${key}=`))?.split('=')[1];

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

function isDenied(conf: string, ip: string): boolean {
  const n = ipv4ToNumber(ip);
  return settings(conf)
    .filter((l) => l.startsWith('denied-peer-ip=') && !l.includes(':'))
    .some((l) => {
      const [from, to] = l.slice('denied-peer-ip='.length).split('-') as [string, string];
      return n >= ipv4ToNumber(from) && n <= ipv4ToNumber(to);
    });
}

describe.each(Object.entries(pools))('coturn %s pool', (_name, conf) => {
  it('authenticates with time-limited shared-secret credentials and keeps the secret out of the file', () => {
    const lines = settings(conf);
    expect(lines).toContain('use-auth-secret');
    expect(lines.some((l) => l.startsWith('static-auth-secret'))).toBe(false);
    expect(lines.some((l) => l.startsWith('user='))).toBe(false);
    for (const forbidden of ['lt-cred-mech', 'no-auth', 'allow-loopback-peers']) expect(lines).not.toContain(forbidden);
  });

  it('is hardened: no CLI, no multicast peers, fingerprints, quotas', () => {
    const lines = settings(conf);
    for (const required of ['no-cli', 'no-multicast-peers', 'fingerprint']) expect(lines).toContain(required);
    expect(Number(value(conf, 'user-quota'))).toBeGreaterThan(0);
    expect(Number(value(conf, 'total-quota'))).toBeGreaterThan(0);
  });

  it('refuses to relay to loopback, private, link-local and carrier-grade NAT addresses', () => {
    for (const ip of ['0.0.0.1', '10.1.2.3', '100.64.1.1', '127.0.0.1', '169.254.169.254', '172.20.0.5', '192.168.1.1', '198.18.0.1', '239.1.1.1']) {
      expect(isDenied(conf, ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '203.0.113.7']) expect(isDenied(conf, ip), ip).toBe(false);
    const lines = settings(conf);
    expect(lines).toContain('denied-peer-ip=::1-::1');
    expect(lines.some((l) => l.startsWith('denied-peer-ip=fc00::'))).toBe(true);
    expect(lines.some((l) => l.startsWith('denied-peer-ip=fe80::'))).toBe(true);
  });
});

describe('coturn pools together', () => {
  it('deny the same peer ranges', () => {
    const denied = (conf: string) => settings(conf).filter((l) => l.startsWith('denied-peer-ip='));
    expect(denied(pools.lite)).toEqual(denied(pools.full));
  });

  it('cap the lite pool at audio speeds and leave the full pool uncapped', () => {
    const cap = Number(value(pools.lite, 'max-bps'));
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(16_000); // bytes per second, about 128 kbit/s
    expect(value(pools.full, 'max-bps')).toBeUndefined();
  });

  it('use different listening ports and non-overlapping relay port ranges', () => {
    expect(value(pools.full, 'listening-port')).not.toBe(value(pools.lite, 'listening-port'));
    const range = (conf: string) => [Number(value(conf, 'min-port')), Number(value(conf, 'max-port'))] as const;
    const [fullMin, fullMax] = range(pools.full);
    const [liteMin, liteMax] = range(pools.lite);
    expect(fullMax < liteMin || liteMax < fullMin).toBe(true);
  });

  it('compose requires the secrets instead of defaulting them', () => {
    const compose = read('compose.yaml');
    expect(compose).toContain('${TURN_SECRET:?');
    expect(compose).toContain('${TURN_LITE_SECRET:?');
  });
});

describe('personal compose relay', () => {
  it('carries every setting of the full pool config, so the file works without the rest of the repository', () => {
    const compose = fs.readFileSync(path.resolve(dir, '../personal/compose.yaml'), 'utf8');
    const inlined = new Set(compose.split('\n').map((l) => l.trim()));
    for (const line of settings(pools.full)) expect(inlined.has(line), line).toBe(true);
  });
});
