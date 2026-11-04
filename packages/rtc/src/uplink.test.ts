import { describe, expect, it } from 'vitest';
import { measureUplinkKbps } from './uplink';

/** A connection with the given speed and round trip, on a clock the fake fetch advances by the time each upload takes. */
function link(kbps: number, rttMs: number) {
  let t = 0;
  const sizes: number[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const bytes = String(init.body).length;
    sizes.push(bytes);
    t += rttMs + (bytes * 8) / kbps;
    return { ok: true } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, now: () => t, sizes };
}

describe('measureUplinkKbps', () => {
  it('reads the speed of a fast connection from the largest upload', async () => {
    const l = link(20_000, 30);
    const kbps = await measureUplinkKbps({ ...l, beaconUrls: ['https://b.example'] });
    expect(kbps).toBeGreaterThan(14_000);
    expect(kbps).toBeLessThan(26_000);
  });

  it('stops at a small upload on a slow connection', async () => {
    const l = link(1_000, 40);
    const kbps = await measureUplinkKbps({ ...l, beaconUrls: ['https://b.example'] });
    expect(kbps).toBeGreaterThan(700);
    expect(kbps).toBeLessThan(1_300);
    expect(Math.max(...l.sizes)).toBeLessThan(200 * 1024);
  });

  it('tries the next beacon when the first does not answer', async () => {
    const l = link(5_000, 20);
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.startsWith('https://down.')) throw new Error('offline');
      return l.fetch(url, init);
    }) as unknown as typeof fetch;
    const kbps = await measureUplinkKbps({ fetch: fetchImpl, now: l.now, beaconUrls: ['https://down.example', 'https://up.example'] });
    expect(kbps).toBeGreaterThan(3_000);
    expect(urls[0]).toContain('down.example');
  });

  it('gives no answer when no beacon takes the upload', async () => {
    const fetchImpl = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    expect(await measureUplinkKbps({ fetch: fetchImpl, beaconUrls: ['https://b.example'] })).toBeUndefined();
  });
});
