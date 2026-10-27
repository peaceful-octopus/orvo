import { describe, expect, it } from 'vitest';
import { DATA_VERSION, encodeDataMessage, isReplayedKind, parseDataMessage, type DataMessage } from './datachannel';
import { MAX_ACTIVITY_DATA_BYTES } from './activity';

const roundTrip = (message: DataMessage) => parseDataMessage(encodeDataMessage(message));

describe('parseDataMessage', () => {
  it('round-trips the call state messages', () => {
    expect(roundTrip({ kind: 'state', audio: true, video: false })).toEqual({ kind: 'state', audio: true, video: false });
    expect(roundTrip({ kind: 'screen', streamId: null })).toEqual({ kind: 'screen', streamId: null });
  });

  it('drops unknown kinds and newer versions', () => {
    expect(parseDataMessage(JSON.stringify({ v: DATA_VERSION, kind: 'telepathy' }))).toBeNull();
    expect(parseDataMessage(JSON.stringify({ v: DATA_VERSION + 1, kind: 'state', audio: true, video: true }))).toBeNull();
    expect(parseDataMessage('not json')).toBeNull();
  });

  it('round-trips activity start, end and presence', () => {
    const start: DataMessage = { kind: 'activity', instanceId: 'i1', activityId: 'snake' };
    expect(roundTrip(start)).toEqual(start);
    expect(roundTrip({ kind: 'activity', instanceId: null })).toEqual({ kind: 'activity', instanceId: null });
    expect(roundTrip({ kind: 'activity-presence', instanceId: 'i1' })).toEqual({ kind: 'activity-presence', instanceId: 'i1' });
  });

  it('rejects starting an activity without saying which one', () => {
    expect(parseDataMessage(JSON.stringify({ v: 1, kind: 'activity', instanceId: 'i1' }))).toBeNull();
  });

  it('round-trips activity messages and keeps the optional recipient', () => {
    const message: DataMessage = { kind: 'activity-msg', instanceId: 'i1', to: 'peer-2', data: { t: 'dir', d: 'up' } };
    expect(roundTrip(message)).toEqual(message);
  });

  it('rejects activity data over the size limit or missing', () => {
    const big = { kind: 'activity-msg', instanceId: 'i1', data: 'x'.repeat(MAX_ACTIVITY_DATA_BYTES) };
    expect(parseDataMessage(JSON.stringify({ v: 1, ...big }))).toBeNull();
    expect(parseDataMessage(JSON.stringify({ v: 1, kind: 'activity-msg', instanceId: 'i1' }))).toBeNull();
  });
});

describe('isReplayedKind', () => {
  it('replays state-like kinds but not activity traffic', () => {
    expect(isReplayedKind('state')).toBe(true);
    expect(isReplayedKind('activity')).toBe(true);
    expect(isReplayedKind('activity-presence')).toBe(true);
    expect(isReplayedKind('activity-msg')).toBe(false);
  });
});
