import { signConfig, toBase64Url } from '@orvo/protocol';
import { makeConfig, testKeys, type TestKeys } from '@orvo/testkit';
import { describe, expect, it } from 'vitest';
import { ConfigClient, defaultConfig, type KeyValueStorage } from './config-client';

const NOW = 1_700_000_000_000;
const keys = testKeys('k1');

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

interface Beacon {
  config?: unknown;
  keys?: Record<string, string>;
  down?: boolean;
}

function network(beacons: Record<string, Beacon>) {
  const calls: string[] = [];
  const impl = (async (url: URL) => {
    const beacon = beacons[url.origin];
    calls.push(`${url.origin}${url.pathname}`);
    if (!beacon || beacon.down) throw new Error('unreachable');
    const body = url.pathname === '/v1/config' ? beacon.config : beacon.keys;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  }) as unknown as typeof fetch;
  return { impl, calls, beacons };
}

const signed = (k: TestKeys, overrides = {}) => signConfig(makeConfig(overrides, NOW), k.kid, k.secretKey);
const encodedKeys = (k: TestKeys) => ({ [k.kid]: toBase64Url(k.publicKey) });

function client(net: ReturnType<typeof network>, extra: Record<string, unknown> = {}) {
  const storage = memoryStorage();
  return {
    storage,
    make: (more: Record<string, unknown> = {}) =>
      new ConfigClient({
        beaconUrls: ['https://a.example'],
        storage,
        fetch: net.impl,
        now: () => NOW,
        graceMs: 1000,
        ...extra,
        ...more,
      }),
  };
}

describe('ConfigClient with embedded keys', () => {
  it('loads and verifies a config from the first beacon', async () => {
    const net = network({ 'https://a.example': { config: signed(keys, { version: 3 }) } });
    const { make } = client(net, { trustedKeys: keys.keys });
    const result = await make().load();
    expect(result).toMatchObject({ source: 'network', config: { version: 3 } });
    expect(net.calls).toEqual(['https://a.example/v1/config']); // no key fetch: keys are pinned
  });

  it('rejects a config signed by an untrusted key and falls back to defaults', async () => {
    const attacker = testKeys('k1');
    const net = network({ 'https://a.example': { config: signed(attacker) } });
    const result = await client(net, { trustedKeys: keys.keys }).make().load();
    expect(result.source).toBe('default');
  });

  it('follows beaconUrls from the config and keeps the seed urls as fallbacks', async () => {
    const net = network({
      'https://a.example': { down: true },
      'https://cached.example': { config: signed(keys, { version: 2, beaconUrls: ['https://cached.example'] }) },
    });
    const { make, storage } = client(net, { trustedKeys: keys.keys });
    storage.setItem('orvo:config', JSON.stringify({ signed: signed(keys, { version: 1, beaconUrls: ['https://cached.example'] }) }));

    const result = await make().load();
    expect(result).toMatchObject({ source: 'network', config: { version: 2 } });
    expect(result.config.beaconUrls).toEqual(['https://cached.example', 'https://a.example']);
  });

  it('falls back to the cached config when no beacon answers', async () => {
    const net = network({ 'https://a.example': { config: signed(keys, { version: 4 }) } });
    const { make } = client(net, { trustedKeys: keys.keys });
    await make().load();

    net.beacons['https://a.example']!.down = true;
    expect(await make().load()).toMatchObject({ source: 'cache', config: { version: 4 } });
  });

  it('refuses a rollback to an older version and keeps the cached one', async () => {
    const net = network({ 'https://a.example': { config: signed(keys, { version: 5 }) } });
    const { make } = client(net, { trustedKeys: keys.keys });
    await make().load();

    net.beacons['https://a.example']!.config = signed(keys, { version: 2 });
    expect(await make().load()).toMatchObject({ source: 'cache', config: { version: 5 } });
  });

  it('stops honoring a cached config long after it expired', async () => {
    const net = network({ 'https://a.example': { config: signed(keys, { validUntil: NOW + 10 }) } });
    const { make } = client(net, { trustedKeys: keys.keys, graceMs: 1000 });
    await make().load();

    net.beacons['https://a.example']!.down = true;
    expect((await make({ now: () => NOW + 5000 }).load()).source).toBe('default');
  });
});

describe('ConfigClient trusting the beacon over HTTPS', () => {
  it('fetches the beacon keys on first contact and caches them', async () => {
    const net = network({ 'https://a.example': { config: signed(keys), keys: encodedKeys(keys) } });
    const { make } = client(net);
    expect((await make().load()).source).toBe('network');
    expect(net.calls).toContain('https://a.example/v1/keys');

    net.calls.length = 0;
    await make().load();
    expect(net.calls).toEqual(['https://a.example/v1/config']); // keys came from the cache
  });

  it('picks up a key rotation by refetching keys when verification fails', async () => {
    const net = network({ 'https://a.example': { config: signed(keys), keys: encodedKeys(keys) } });
    const { make } = client(net);
    await make().load();

    const rotated = testKeys('k2');
    net.beacons['https://a.example'] = { config: signed(rotated, { version: 9 }), keys: encodedKeys(rotated) };
    expect(await make().load()).toMatchObject({ source: 'network', config: { version: 9 } });
  });

  it('rejects a config that does not match the keys the beacon itself serves', async () => {
    const attacker = testKeys('k1');
    const net = network({ 'https://a.example': { config: signed(attacker), keys: encodedKeys(keys) } });
    expect((await client(net).make().load()).source).toBe('default');
  });
});

describe('defaultConfig', () => {
  it('has the built-in limits and the supplied beacon urls', () => {
    const config = defaultConfig(['https://a.example'], NOW);
    expect(config.limits).toMatchObject({ maxRoomSize: 10, warnRoomSize: 6 });
    expect(config.beaconUrls).toEqual(['https://a.example']);
  });
});
