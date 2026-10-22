import { z } from 'zod';

const ms = z.number().int().min(0).max(10 * 60_000);

/**
 * Anonymous connection statistics. They carry no identifiers: no room ids, peer ids, names or addresses,
 * only outcomes and timings, so an operator can see how often calls connect directly or need a relay.
 */
export const TelemetryEvent = z.discriminatedUnion('type', [
  /** Joining a room, from the beacon request to the node admitting us. */
  z.object({ type: z.literal('join'), result: z.enum(['ok', 'room-full', 'upgrade-required', 'unreachable', 'error']), ms }),
  /** One peer-to-peer connection settled: it connected (and how it is routed) or could not be established. */
  z.object({
    type: z.literal('peer'),
    result: z.enum(['connected', 'unreachable']),
    route: z.enum(['direct', 'relay', 'unknown']),
    ms,
  }),
  /** Signaling connection lost and then recovered (`ok`) or given up on. */
  z.object({ type: z.literal('reconnect'), ok: z.boolean(), attempts: z.number().int().min(1).max(1000) }),
]);
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

export const MAX_TELEMETRY_EVENTS = 50;

export const TelemetryBatch = z.object({
  v: z.literal(1),
  events: z.array(TelemetryEvent).max(MAX_TELEMETRY_EVENTS),
});
export type TelemetryBatch = z.infer<typeof TelemetryBatch>;
