import { z } from 'zod';
import { PROTOCOL_VERSION } from './version';

/** Largest signaling frame a node accepts; SDP offers fit well below this. */
/** Offers carrying a camera, a microphone and a shared screen run to about 11 KB, so this leaves room to grow. */
export const MAX_FRAME_BYTES = 32 * 1024;
export const MAX_NAME_LENGTH = 40;

export const ErrorCode = z.enum([
  'room-full',
  'bad-token',
  'not-owner',
  'draining',
  'upgrade-required',
  'rate-limited',
  'bad-request',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

const v = z.literal(PROTOCOL_VERSION);
const name = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const peerId = z.string().min(1).max(64);
const peer = z.object({ id: peerId, name });

export const RoomStatus = z.enum(['ok', 'degraded', 'full']);

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('join'), token: z.string().min(1), name }),
  z.object({ v, type: z.literal('signal'), to: peerId, payload: z.unknown() }),
  z.object({ v, type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('welcome'), peerId, peers: z.array(peer), status: RoomStatus, resumed: z.boolean() }),
  z.object({ v, type: z.literal('peer-joined'), peer }),
  z.object({ v, type: z.literal('peer-left'), id: peerId }),
  z.object({ v, type: z.literal('signal'), from: peerId, payload: z.unknown() }),
  z.object({ v, type: z.literal('error'), code: ErrorCode, message: z.string().max(200).optional() }),
  z.object({ v, type: z.literal('pong') }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type ParseResult<T> = { ok: true; message: T } | { ok: false; code: ErrorCode };

function parseFrame<T>(schema: z.ZodType<T>, raw: string | Uint8Array): ParseResult<T> {
  const size = typeof raw === 'string' ? new TextEncoder().encode(raw).length : raw.byteLength;
  if (size > MAX_FRAME_BYTES) return { ok: false, code: 'bad-request' };
  let json: unknown;
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
  } catch {
    return { ok: false, code: 'bad-request' };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, message: result.data } : { ok: false, code: 'bad-request' };
}

export const parseClientMessage = (raw: string | Uint8Array) => parseFrame(ClientMessage, raw);
export const parseServerMessage = (raw: string | Uint8Array) => parseFrame(ServerMessage, raw);

type WithoutVersion<T> = T extends unknown ? Omit<T, 'v'> : never;

/** A server message as written by code, without the protocol version that `encodeServerMessage` adds. */
export type ServerMessageBody = WithoutVersion<ServerMessage>;

export function encodeServerMessage(message: ServerMessageBody): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...message });
}
