import type { TelemetryEvent } from '@orvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryClient } from './telemetry-client';

const peer: TelemetryEvent = { type: 'peer', result: 'connected', route: 'direct', ms: 300 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(extra: { enabled?: boolean; fail?: boolean; maxQueue?: number } = {}) {
  const state = { enabled: extra.enabled ?? true };
  const sent: { url: string; body: { v: number; events: TelemetryEvent[] } }[] = [];
  const beacons: string[] = [];
  const impl = (async (url: URL, init: RequestInit) => {
    if (extra.fail) throw new Error('offline');
    sent.push({ url: url.toString(), body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const client = new TelemetryClient({
    beaconUrls: () => ['https://orvo.example.com', 'https://backup.example.com'],
    enabled: () => state.enabled,
    fetch: impl,
    sendBeacon: (url, body) => (beacons.push(url), void body, true),
    flushMs: 1_000,
    maxQueue: extra.maxQueue,
  });
  return { client, state, sent, beacons };
}

describe('TelemetryClient', () => {
  it('batches events and sends them to the first beacon on the interval', async () => {
    const { client, sent } = setup();
    client.start();
    client.record(peer);
    client.record({ type: 'join', result: 'ok', ms: 900 });
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://orvo.example.com/v1/telemetry');
    expect(sent[0]!.body.events).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(1); // nothing new to say
    client.stop();
  });

  it('records and sends nothing while telemetry is off, and discards what was queued', async () => {
    const { client, state, sent } = setup();
    client.start();
    client.record(peer);
    state.enabled = false;
    client.record(peer);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(0);

    state.enabled = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(0); // the earlier event was dropped, not held back
    client.stop();
  });

  it('keeps the queue bounded, dropping the oldest events', async () => {
    const { client, sent } = setup({ maxQueue: 3 });
    for (let i = 0; i < 5; i++) client.record({ type: 'join', result: 'ok', ms: i });
    await client.flush();
    expect(sent[0]!.body.events.map((e) => (e as { ms: number }).ms)).toEqual([2, 3, 4]);
  });

  it('splits large queues into batches within the size limit', async () => {
    const { client, sent } = setup({ maxQueue: 500 });
    for (let i = 0; i < 120; i++) client.record(peer);
    await client.flush();
    await client.flush();
    await client.flush();
    expect(sent.map((s) => s.body.events.length)).toEqual([50, 50, 20]);
  });

  it('swallows network failures', async () => {
    const { client } = setup({ fail: true });
    client.record(peer);
    await expect(client.flush()).resolves.toBeUndefined();
  });

  it('flushes on stop', async () => {
    const { client, sent } = setup();
    client.start();
    client.record(peer);
    client.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
  });

  it('does nothing when there is no beacon address', async () => {
    const sent: unknown[] = [];
    const client = new TelemetryClient({
      beaconUrls: () => [],
      enabled: () => true,
      fetch: (async () => (sent.push(1), new Response(null))) as unknown as typeof fetch,
    });
    client.record(peer);
    await client.flush();
    expect(sent).toHaveLength(0);
  });
});
