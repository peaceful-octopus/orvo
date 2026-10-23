import { z } from 'zod';

/** Version of the peer-to-peer data-channel messages (independent of the signaling protocol). */
export const DATA_VERSION = 1;

const envelope = z.object({ v: z.number().int(), kind: z.string() }).loose();

import { MAX_NAME_LENGTH } from './signaling';

const stateMessage = z.object({ kind: z.literal('state'), audio: z.boolean(), video: z.boolean() });
/** A participant changed their display name during the call. */
const nameMessage = z.object({ kind: z.literal('name'), name: z.string().trim().min(1).max(MAX_NAME_LENGTH) });

/** Which of the sender's media streams is a shared screen (the others are the camera), or null when sharing stopped. */
const screenMessage = z.object({ kind: z.literal('screen'), streamId: z.string().min(1).max(200).nullable() });

export type DataMessage =
  | { kind: 'state'; audio: boolean; video: boolean }
  | { kind: 'name'; name: string }
  | { kind: 'screen'; streamId: string | null };

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
  const message = z.union([stateMessage, nameMessage, screenMessage]).safeParse(value);
  return message.success ? message.data : null;
}
