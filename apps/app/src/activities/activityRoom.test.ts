import { describe, expect, it } from 'vitest';
import { emptyRoom, ended, participantsOf, peerLeft, receive, setPresence, started } from './activityRoom';

const start = (instanceId: string, activityId = 'snake') => ({ kind: 'activity' as const, instanceId, activityId });
const open = (instanceId: string | null) => ({ kind: 'activity-presence' as const, instanceId });

describe('activityRoom', () => {
  it('learns about an activity from whoever started it', () => {
    const room = receive(emptyRoom(), 'alice', start('i1'));
    expect(room.current).toEqual({ instanceId: 'i1', activityId: 'snake', starter: 'alice' });
  });

  it('ends only when the starter says so', () => {
    let room = receive(emptyRoom(), 'alice', start('i1'));
    room = receive(room, 'bob', { kind: 'activity', instanceId: null });
    expect(room.current).toBeDefined();
    room = receive(room, 'alice', { kind: 'activity', instanceId: null });
    expect(room.current).toBeUndefined();
  });

  it('ignores a start that names no activity', () => {
    expect(receive(emptyRoom(), 'alice', { kind: 'activity', instanceId: 'i1' }).current).toBeUndefined();
  });

  it('settles simultaneous starts on the smaller instance id, whichever order they arrive in', () => {
    const a = receive(receive(emptyRoom(), 'alice', start('i1')), 'bob', start('i2'));
    const b = receive(receive(emptyRoom(), 'bob', start('i2')), 'alice', start('i1'));
    expect(a.current?.instanceId).toBe('i1');
    expect(b.current?.instanceId).toBe('i1');
  });

  it('lets the same starter begin a new instance after the old one', () => {
    let room = receive(emptyRoom(), 'alice', start('i2'));
    room = receive(room, 'alice', start('i3'));
    expect(room.current?.instanceId).toBe('i3');
  });

  it('counts participants who have the current instance open, however the messages were ordered', () => {
    let room = receive(emptyRoom(), 'bob', open('i1')); // arrives before the activity itself
    room = receive(room, 'carol', open('other'));
    room = receive(room, 'alice', start('i1'));
    room = setPresence(room, 'me', 'i1');
    expect(participantsOf(room)).toEqual(['bob', 'me']);
    room = receive(room, 'bob', open(null));
    expect(participantsOf(room)).toEqual(['me']);
  });

  it('has no participants when nothing is running', () => {
    expect(participantsOf(receive(emptyRoom(), 'bob', open('i1')))).toEqual([]);
  });

  it('ends the activity when its starter leaves, and forgets anyone who leaves', () => {
    let room = receive(emptyRoom(), 'alice', start('i1'));
    room = receive(room, 'bob', open('i1'));
    expect(peerLeft(room, 'bob').current).toBeDefined();
    expect(participantsOf(peerLeft(room, 'bob'))).toEqual([]);
    expect(peerLeft(room, 'alice').current).toBeUndefined();
  });

  it('tracks starting and ending from your own side', () => {
    let room = started(emptyRoom(), 'me', 'i9', 'snake');
    expect(room.current?.starter).toBe('me');
    room = ended(room);
    expect(room.current).toBeUndefined();
  });
});
