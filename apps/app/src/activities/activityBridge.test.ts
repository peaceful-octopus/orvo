import { MAX_ACTIVITY_DATA_BYTES, MAX_ACTIVITY_MESSAGES_PER_SECOND, type ActivityDataMessages, type ActivityHostMessage } from '@orvo/protocol';
import { describe, expect, it } from 'vitest';
import { ActivityBridge } from './activityBridge';

const me = { id: 'me', name: 'Me' };
const bob = { id: 'bob', name: 'Bob' };
const carol = { id: 'carol', name: 'Carol' };

function setup(host = 'me') {
  const posted: ActivityHostMessage[] = [];
  const sent: ActivityDataMessages[] = [];
  const calls = { ready: 0, end: 0 };
  const clock = { now: 1000 };
  const bridge = new ActivityBridge({
    instanceId: 'i1',
    self: me,
    host,
    participants: [me, bob],
    theme: { '--bg': '#000' },
    post: (m) => posted.push(m),
    send: (m) => sent.push(m),
    onReady: () => calls.ready++,
    onEnd: () => calls.end++,
    now: () => clock.now,
  });
  const frame = (message: object) => bridge.fromFrame({ orvo: 1, ...message });
  return { bridge, posted, sent, calls, clock, frame };
}

const msg = (from: string, data: unknown, extra: object = {}): [string, ActivityDataMessages] => [
  from,
  { kind: 'activity-msg', instanceId: 'i1', data, ...extra },
];

describe('ActivityBridge from the frame', () => {
  it('answers ready with the call as it is, and tells the page the activity is open', () => {
    const { frame, posted, calls } = setup();
    frame({ type: 'ready' });
    expect(posted).toEqual([
      expect.objectContaining({
        type: 'init',
        instanceId: 'i1',
        self: me,
        host: 'me',
        isHost: true,
        participants: [me, bob],
        theme: { '--bg': '#000' },
        capabilities: [],
      }),
    ]);
    expect(calls.ready).toBe(1);
  });

  it('introduces itself once, even if ready arrives twice', () => {
    const { frame, posted, calls } = setup();
    frame({ type: 'ready' });
    frame({ type: 'ready' });
    expect(posted).toHaveLength(1);
    expect(calls.ready).toBe(1);
  });

  it('marks a guest as not the host', () => {
    const { frame, posted } = setup('bob');
    frame({ type: 'ready' });
    expect(posted[0]).toMatchObject({ isHost: false, host: 'bob' });
  });

  it('sends what the activity sends, tagged with its instance, and keeps the recipient', () => {
    const { frame, sent } = setup();
    frame({ type: 'ready' });
    frame({ type: 'send', data: { a: 1 } });
    frame({ type: 'send', to: 'bob', data: 'hi' });
    expect(sent).toEqual([
      { kind: 'activity-msg', instanceId: 'i1', data: { a: 1 } },
      { kind: 'activity-msg', instanceId: 'i1', to: 'bob', data: 'hi' },
    ]);
  });

  it('drops anything before ready, malformed, oversize, or without the envelope', () => {
    const { bridge, frame, sent } = setup();
    frame({ type: 'send', data: 1 });
    frame({ type: 'ready' });
    frame({ type: 'send', data: 'x'.repeat(MAX_ACTIVITY_DATA_BYTES) });
    frame({ type: 'nonsense' });
    bridge.fromFrame({ type: 'send', data: 1 });
    bridge.fromFrame('send');
    bridge.fromFrame(null);
    expect(sent).toEqual([]);
  });

  it('limits how fast an activity can send, and allows more after the second is over', () => {
    const { frame, sent, clock } = setup();
    frame({ type: 'ready' });
    for (let i = 0; i < MAX_ACTIVITY_MESSAGES_PER_SECOND + 40; i++) frame({ type: 'send', data: i });
    expect(sent).toHaveLength(MAX_ACTIVITY_MESSAGES_PER_SECOND);
    clock.now += 1000;
    frame({ type: 'send', data: 'later' });
    expect(sent).toHaveLength(MAX_ACTIVITY_MESSAGES_PER_SECOND + 1);
  });

  it('lets only the host end the activity', () => {
    const host = setup('me');
    host.frame({ type: 'ready' });
    host.frame({ type: 'end' });
    expect(host.calls.end).toBe(1);

    const guest = setup('bob');
    guest.frame({ type: 'ready' });
    guest.frame({ type: 'end' });
    expect(guest.calls.end).toBe(0);
  });
});

describe('ActivityBridge from peers', () => {
  it('passes on messages from participants for this instance', () => {
    const { bridge, frame, posted } = setup();
    frame({ type: 'ready' });
    bridge.fromPeer(...msg('bob', { t: 'dir' }));
    expect(posted.at(-1)).toEqual({ orvo: 1, type: 'message', from: 'bob', data: { t: 'dir' } });
  });

  it('drops messages for another instance, from non-participants, before ready, or for someone else', () => {
    const { bridge, frame, posted } = setup();
    bridge.fromPeer(...msg('bob', 1)); // before ready
    frame({ type: 'ready' });
    const before = posted.length;
    bridge.fromPeer('bob', { kind: 'activity-msg', instanceId: 'other', data: 1 });
    bridge.fromPeer(...msg('carol', 2)); // has not opened the activity
    bridge.fromPeer(...msg('bob', 3, { to: 'carol' }));
    bridge.fromPeer('bob', { kind: 'activity', instanceId: 'i1', activityId: 'snake' });
    expect(posted).toHaveLength(before);
    bridge.fromPeer(...msg('bob', 4, { to: 'me' }));
    expect(posted).toHaveLength(before + 1);
  });

  it('limits each participant separately', () => {
    const { bridge, frame, posted } = setup();
    frame({ type: 'ready' });
    bridge.setParticipants([me, bob, carol]);
    for (let i = 0; i < MAX_ACTIVITY_MESSAGES_PER_SECOND + 20; i++) bridge.fromPeer(...msg('bob', i));
    const fromBob = posted.filter((m) => m.type === 'message' && m.from === 'bob');
    expect(fromBob).toHaveLength(MAX_ACTIVITY_MESSAGES_PER_SECOND);
    bridge.fromPeer(...msg('carol', 'still heard'));
    expect(posted.at(-1)).toMatchObject({ type: 'message', from: 'carol' });
  });
});

describe('ActivityBridge participants', () => {
  it('reports who joined and left once the page is ready', () => {
    const { bridge, frame, posted } = setup();
    bridge.setParticipants([me, bob, carol]); // before ready: part of init instead
    expect(posted).toEqual([]);
    frame({ type: 'ready' });
    expect(posted[0]).toMatchObject({ type: 'init', participants: [me, bob, carol] });

    bridge.setParticipants([me, carol]);
    expect(posted.at(-1)).toEqual({ orvo: 1, type: 'participant-left', id: 'bob' });
    bridge.setParticipants([me, carol, bob]);
    expect(posted.at(-1)).toEqual({ orvo: 1, type: 'participant-joined', participant: bob });
  });

  it('tells the page when the activity is over', () => {
    const { bridge, frame, posted } = setup();
    bridge.close(); // nothing to tell before it started
    expect(posted).toEqual([]);
    frame({ type: 'ready' });
    bridge.close();
    expect(posted.at(-1)).toEqual({ orvo: 1, type: 'close' });
  });
});
