import { describe, expect, it } from 'vitest';
import { MAX_TELEMETRY_EVENTS, TelemetryBatch } from './telemetry';

const peer = { type: 'peer', result: 'connected', route: 'direct', ms: 420 };

describe('TelemetryBatch', () => {
  it('accepts the three event kinds', () => {
    const batch = {
      v: 1,
      events: [
        { type: 'join', result: 'ok', ms: 800 },
        peer,
        { type: 'reconnect', ok: true, attempts: 2 },
      ],
    };
    expect(TelemetryBatch.safeParse(batch).success).toBe(true);
  });

  it('rejects unknown kinds, values out of range and wrong versions', () => {
    const bad = (events: unknown[], v = 1) => TelemetryBatch.safeParse({ v, events }).success;
    expect(bad([{ type: 'mystery' }])).toBe(false);
    expect(bad([{ ...peer, ms: -1 }])).toBe(false);
    expect(bad([{ ...peer, ms: 10 * 60_000 + 1 }])).toBe(false);
    expect(bad([{ ...peer, route: 'carrier-pigeon' }])).toBe(false);
    expect(bad([peer], 2)).toBe(false);
  });

  it('limits the batch size', () => {
    expect(TelemetryBatch.safeParse({ v: 1, events: Array(MAX_TELEMETRY_EVENTS).fill(peer) }).success).toBe(true);
    expect(TelemetryBatch.safeParse({ v: 1, events: Array(MAX_TELEMETRY_EVENTS + 1).fill(peer) }).success).toBe(false);
  });

  it('drops anything that could identify a user (fields outside the schema are stripped)', () => {
    const parsed = TelemetryBatch.parse({ v: 1, events: [{ ...peer, room: 'secret-room', name: 'Ann', ip: '1.2.3.4' }] });
    expect(parsed.events[0]).toEqual(peer);
  });
});
