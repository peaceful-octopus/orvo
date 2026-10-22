import { describe, expect, it } from 'vitest';
import { RoomRegistry } from './rooms';

const id = (room: string, n: number) => `${room}_peer${n}`;

describe('RoomRegistry', () => {
  it('refuses the 11th member of a room', () => {
    const rooms = new RoomRegistry();
    for (let n = 0; n < 10; n++) expect(rooms.add(id('party-room', n))).toBe(true);
    expect(rooms.add(id('party-room', 10))).toBe(false);
    expect(rooms.info('party-room').status).toBe('full');
  });

  it('reports degraded above 6 and frees a slot on remove', () => {
    const rooms = new RoomRegistry();
    for (let n = 0; n < 7; n++) rooms.add(id('party-room', n));
    expect(rooms.info('party-room').status).toBe('degraded');
    rooms.remove(id('party-room', 0));
    expect(rooms.info('party-room').status).toBe('ok');
  });

  it('keeps rooms separate and rejects malformed ids', () => {
    const rooms = new RoomRegistry();
    rooms.add(id('room-a', 1));
    expect(rooms.info('room-b').peers).toEqual([]);
    expect(rooms.add('not-a-room-id')).toBe(false);
  });
});
