import { z } from 'zod';

/** Version of the peer-to-peer data-channel messages (independent of the signaling protocol). */
export const DATA_VERSION = 1;

const envelope = z.object({ v: z.number().int(), kind: z.string() }).loose();

const stateMessage = z.object({ kind: z.literal('state'), audio: z.boolean(), video: z.boolean() });

export type DataMessage = { kind: 'state'; audio: boolean; video: boolean };

export function encodeDataMessage(message: DataMessage): string {
  return JSON.stringify({ v: DATA_VERSION, ...message });
}

/**
 * Parses a data-channel message from a peer. Returns null for anything unrecognized, including
 * messages from a newer version, so older clients ignore what they do not understand.
 */
export function parseDataMessage(raw: unknown): DataMessage | null {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const head = envelope.safeParse(value);
  if (!head.success || head.data.v > DATA_VERSION) return null;
  const state = stateMessage.safeParse(value);
  return state.success ? state.data : null;
}
