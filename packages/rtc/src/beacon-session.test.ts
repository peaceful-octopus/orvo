import { describe, expect, it } from 'vitest';
import { requestJoin } from './beacon-session';
import { BeaconUnavailableError, JoinError, UpgradeRequiredError } from './transport';

const session = {
  signalingUrl: 'wss://n1/ws',
  joinToken: 't',
  resumeToken: 'r',
  peerId: 'p1',
  iceServers: [],
  transport: 'mesh',
  tier: 'free',
};
const params = { room: 'cozy-room-abc123', clientVersion: '1.0.0' };

type Reply = Response | Error;
function fakeFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const impl = (async (url: URL) => {
    calls.push(url.origin);
    const reply = replies[url.origin];
    if (!reply || reply instanceof Error) throw reply ?? new Error('unreachable');
    return reply.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('requestJoin', () => {
  it('returns the first beacon that answers', async () => {
    const f = fakeFetch({ 'https://a.example': json(session) });
    expect((await requestJoin(['https://a.example', 'https://b.example'], params, f.impl)).peerId).toBe('p1');
    expect(f.calls).toEqual(['https://a.example']);
  });

  it('fails over past unreachable and failing beacons', async () => {
    const f = fakeFetch({
      'https://a.example': new Error('down'),
      'https://b.example': json({ error: 'boom' }, 502),
      'https://c.example': json(session),
    });
    await requestJoin(['https://a.example', 'https://b.example', 'https://c.example'], params, f.impl);
    expect(f.calls).toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
  });

  it('treats an upgrade-required answer as final', async () => {
    const f = fakeFetch({ 'https://a.example': json({}, 426), 'https://b.example': json(session) });
    await expect(requestJoin(['https://a.example', 'https://b.example'], params, f.impl)).rejects.toBeInstanceOf(UpgradeRequiredError);
    expect(f.calls).toEqual(['https://a.example']);
  });

  it('treats a bad request as final but a 503 as a reason to try the next beacon', async () => {
    const f = fakeFetch({ 'https://a.example': json({}, 400), 'https://b.example': json(session) });
    await expect(requestJoin(['https://a.example', 'https://b.example'], params, f.impl)).rejects.toBeInstanceOf(JoinError);

    const g = fakeFetch({ 'https://a.example': json({}, 503), 'https://b.example': json(session) });
    expect((await requestJoin(['https://a.example', 'https://b.example'], params, g.impl)).peerId).toBe('p1');
  });

  it('explains when nothing answers', async () => {
    const f = fakeFetch({});
    await expect(requestJoin(['https://a.example'], params, f.impl)).rejects.toThrow('Could not reach the server.');
    await expect(requestJoin(['https://a.example'], params, f.impl)).rejects.toBeInstanceOf(BeaconUnavailableError);
    const g = fakeFetch({ 'https://a.example': json({}, 503) });
    await expect(requestJoin(['https://a.example'], params, g.impl)).rejects.toThrow('No server is available');
  });
});
