import { describe, expect, it } from 'vitest';
import { isValidRoomSlug, peerIdFor, roomOfPeerId } from './ids';

describe('room ids', () => {
  it('round-trips a room through a peer id', () => {
    expect(roomOfPeerId(peerIdFor('cozy-fox-42'))).toBe('cozy-fox-42');
  });

  it('rejects malformed slugs and ids', () => {
    expect(isValidRoomSlug('ab')).toBe(false);
    expect(isValidRoomSlug('Has_Underscore')).toBe(false);
    expect(roomOfPeerId('noseparator')).toBeNull();
    expect(roomOfPeerId('BAD ROOM_abc')).toBeNull();
  });
});
