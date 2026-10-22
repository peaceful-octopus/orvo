import { describe, expect, it } from 'vitest';
import { routeFromStats, sendPolicy, type StatsLike } from './route';

function report(stats: Record<string, Record<string, unknown>>): StatsLike {
  return {
    get: (id) => stats[id],
    forEach: (cb) => Object.values(stats).forEach(cb),
  };
}

const candidates = (local: string, remote: string) => ({
  l: { type: 'local-candidate', candidateType: local },
  r: { type: 'remote-candidate', candidateType: remote },
});

describe('routeFromStats', () => {
  it('reports direct for host and server-reflexive pairs', () => {
    expect(
      routeFromStats(report({ t: { type: 'transport', selectedCandidatePairId: 'p' }, p: { type: 'candidate-pair', localCandidateId: 'l', remoteCandidateId: 'r' }, ...candidates('host', 'srflx') })),
    ).toBe('direct');
  });

  it('reports relay when either end is relayed', () => {
    const base = { t: { type: 'transport', selectedCandidatePairId: 'p' }, p: { type: 'candidate-pair', localCandidateId: 'l', remoteCandidateId: 'r' } };
    expect(routeFromStats(report({ ...base, ...candidates('relay', 'host') }))).toBe('relay');
    expect(routeFromStats(report({ ...base, ...candidates('host', 'relay') }))).toBe('relay');
  });

  it('falls back to the nominated succeeded pair when no transport reports a selection', () => {
    const stats = {
      a: { type: 'candidate-pair', state: 'failed', nominated: false, localCandidateId: 'l', remoteCandidateId: 'r' },
      b: { type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l2', remoteCandidateId: 'r2' },
      l: { type: 'local-candidate', candidateType: 'host' },
      r: { type: 'remote-candidate', candidateType: 'host' },
      l2: { type: 'local-candidate', candidateType: 'relay' },
      r2: { type: 'remote-candidate', candidateType: 'host' },
    };
    expect(routeFromStats(report(stats))).toBe('relay');
  });

  it('is unknown when nothing is selected yet or candidate types are missing', () => {
    expect(routeFromStats(report({}))).toBe('unknown');
    expect(routeFromStats(report({ t: { type: 'transport' } }))).toBe('unknown');
    expect(
      routeFromStats(report({ t: { type: 'transport', selectedCandidatePairId: 'p' }, p: { type: 'candidate-pair', localCandidateId: 'x', remoteCandidateId: 'y' } })),
    ).toBe('unknown');
  });
});

describe('sendPolicy', () => {
  const normal = { maxBitrate: 1_000_000, scaleResolutionDownBy: 1, maxFramerate: 30 };
  const relayed = { maxBitrate: 200_000, scaleResolutionDownBy: 2, maxFramerate: 15 };

  it('does not change anything on direct or unknown routes', () => {
    for (const route of ['direct', 'unknown'] as const) {
      for (const tier of ['free', 'relay-lite', 'full'] as const) {
        expect(sendPolicy(route, tier, normal, relayed)).toEqual({ video: true, tier: normal });
      }
    }
  });

  it('uses the lower relayed tier on relayed paths in full rooms', () => {
    expect(sendPolicy('relay', 'full', normal, relayed)).toEqual({ video: true, tier: relayed });
  });

  it('never raises quality above the room tier on relayed paths', () => {
    const small = { maxBitrate: 100_000, scaleResolutionDownBy: 2, maxFramerate: 10 };
    expect(sendPolicy('relay', 'full', small, relayed).tier).toEqual(small);
  });

  it('sends no video over the capped relay of a relay-lite room', () => {
    expect(sendPolicy('relay', 'relay-lite', normal, relayed)).toEqual({ video: false, tier: relayed });
  });
});
