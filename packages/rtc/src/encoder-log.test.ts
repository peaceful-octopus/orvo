import { describe, expect, it } from 'vitest';
import { EncoderLog } from './encoder-log';
import type { StatsLike } from './route';

function report(...stats: Record<string, unknown>[]): StatsLike {
  return { get: () => undefined, forEach: (cb) => stats.forEach(cb) };
}
const video = (framesEncoded: number, totalEncodeTime: number, extra: Record<string, unknown> = {}) => ({
  type: 'outbound-rtp',
  kind: 'video',
  id: 'v1',
  framesEncoded,
  totalEncodeTime,
  qualityLimitationReason: 'none',
  ...extra,
});

describe('EncoderLog', () => {
  it('reports nothing when no video was encoded', () => {
    const log = new EncoderLog();
    log.add('a', report({ type: 'outbound-rtp', kind: 'audio', id: 'a1' }));
    expect(log.summary()).toBeUndefined();
  });

  it('averages the encode time per frame from the change between polls', () => {
    const log = new EncoderLog();
    log.add('a', report(video(100, 1))); // the first poll only sets a starting point
    log.add('a', report(video(400, 4))); // 300 frames in 3 s, then 100 in 2 s: 400 frames in 5 s is 12.5 ms each
    log.add('a', report(video(500, 6)));
    expect(log.summary()).toMatchObject({ samples: 2, encodeMs: 13, peers: 1, cpuLimited: 0 });
  });

  it('counts the polls where the browser held quality down, and for which reason', () => {
    const log = new EncoderLog();
    log.add('a', report(video(0, 0)));
    log.add('a', report(video(30, 0.3, { qualityLimitationReason: 'cpu' })));
    log.add('a', report(video(60, 0.6, { qualityLimitationReason: 'bandwidth' })));
    log.add('a', report(video(90, 0.9)));
    expect(log.summary()).toMatchObject({ samples: 3, cpuLimited: 1, bandwidthLimited: 1 });
  });

  it('ignores a connection that is not sending new frames, and counts connections open at once', () => {
    const log = new EncoderLog();
    for (const id of ['a', 'b', 'c']) {
      log.add(id, report(video(0, 0)));
      log.add(id, report(video(30, 0.3)));
    }
    log.add('a', report(video(30, 0.3))); // paused
    log.remove('c');
    expect(log.summary()).toMatchObject({ samples: 3, peers: 3 });
  });

  it('survives browsers that leave the fields out, and notes a hardware encoder', () => {
    const log = new EncoderLog();
    log.add('a', report({ type: 'outbound-rtp', kind: 'video', id: 'v1' }));
    expect(log.summary()).toBeUndefined();
    log.add('a', report(video(0, 0)));
    log.add('a', report(video(30, 0.3, { powerEfficientEncoder: true })));
    expect(log.summary()?.hardware).toBe(true);
  });

  it('starts over after a reset', () => {
    const log = new EncoderLog();
    log.add('a', report(video(0, 0)));
    log.add('a', report(video(30, 0.3)));
    log.reset();
    expect(log.summary()).toBeUndefined();
  });
});
