import { describe, expect, it } from 'vitest';
import { requestJoin } from './beacon-session';
import { InvalidTokenError, LoginRequiredError } from './transport';

const session = { signalingUrl: 'wss://n1/ws', joinToken: 't', resumeToken: 'r', peerId: 'p1', iceServers: [], transport: 'mesh', tier: 'free' };
const params = { room: 'cozy-room-abc123', clientVersion: '1.0.0' };

function recording(reply: () => Response) {
  const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const impl = (async (_url: URL, init: RequestInit) => {
    seen.push({ headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return reply();
  }) as unknown as typeof fetch;
  return { impl, seen };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('requestJoin with an account', () => {
  it('sends the ID token as a bearer token, and never in the body', async () => {
    const f = recording(() => json(session));
    await requestJoin(['https://a.example'], { ...params, authToken: 'id-token-123' }, f.impl);
    expect(f.seen[0]!.headers.authorization).toBe('Bearer id-token-123');
    expect(JSON.stringify(f.seen[0]!.body)).not.toContain('id-token-123');
    expect(f.seen[0]!.body).not.toHaveProperty('authToken');
  });

  it('sends no authorization header for a guest', async () => {
    const f = recording(() => json(session));
    await requestJoin(['https://a.example'], params, f.impl);
    expect(f.seen[0]!.headers).not.toHaveProperty('authorization');
  });

  it('reports that signing in is needed, and why', async () => {
    const create = recording(() => json({ code: 'login-required-to-create' }, 401));
    await expect(requestJoin(['https://a.example'], params, create.impl)).rejects.toMatchObject({ reason: 'create' });
    const join = recording(() => json({ code: 'login-required-to-join' }, 401));
    const err = await requestJoin(['https://a.example'], params, join.impl).catch((e) => e);
    expect(err).toBeInstanceOf(LoginRequiredError);
    expect(err.reason).toBe('join');
  });

  it('reports a sign-in that was not accepted, and does not try the next beacon for it', async () => {
    const f = recording(() => json({ code: 'invalid-token' }, 401));
    await expect(requestJoin(['https://a.example', 'https://b.example'], { ...params, authToken: 'old' }, f.impl)).rejects.toBeInstanceOf(InvalidTokenError);
    expect(f.seen).toHaveLength(1);
  });
});
