import { describe, expect, it } from 'vitest';
import { authorizeUrl, claimsOf, createPkce, discover, exchangeCode, needsRefresh, refreshTokens } from './oidc';

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (claims: object) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('createPkce', () => {
  it('gives a verifier and the SHA-256 fingerprint the provider will compare it with', async () => {
    const { verifier, challenge } = await createPkce();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
    expect(verifier.length).toBeGreaterThanOrEqual(43); // the shortest the standard allows
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', async () => {
    expect((await createPkce()).verifier).not.toBe((await createPkce()).verifier);
  });
});

describe('discover', () => {
  it('finds the endpoints from the provider\'s published document', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return json({ authorization_endpoint: 'https://id.example/auth', token_endpoint: 'https://id.example/token' });
    }) as unknown as typeof fetch;
    expect(await discover('https://id.example/', fetchImpl)).toEqual({ authorization: 'https://id.example/auth', token: 'https://id.example/token' });
    expect(seen).toEqual(['https://id.example/.well-known/openid-configuration']);
  });

  it('explains a provider that does not answer or lacks endpoints', async () => {
    await expect(discover('https://id.example', (async () => json({}, 500)) as unknown as typeof fetch)).rejects.toThrow(/did not answer/);
    await expect(discover('https://id.example', (async () => json({})) as unknown as typeof fetch)).rejects.toThrow(/endpoints/);
  });
});

describe('authorizeUrl', () => {
  it('asks for a code with PKCE and carries the state and nonce back', () => {
    const url = new URL(
      authorizeUrl({ endpoint: 'https://id.example/auth', clientId: 'app', redirectUri: 'https://chill.example/auth/callback', scope: 'openid profile', state: 's1', challenge: 'c1', nonce: 'n1' }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'app',
      redirect_uri: 'https://chill.example/auth/callback',
      scope: 'openid profile',
      state: 's1',
      nonce: 'n1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
    });
  });
});

describe('claimsOf', () => {
  it('reads the name and expiry, and refuses anything that is not a token', () => {
    expect(claimsOf(idToken({ sub: 'u1', name: 'Ann', exp: 123 }))).toMatchObject({ sub: 'u1', name: 'Ann', exp: 123 });
    expect(claimsOf('nonsense')).toBeUndefined();
    expect(claimsOf(idToken({ name: 'No subject', exp: 1 }))).toBeUndefined();
    expect(claimsOf(idToken({ sub: 'u1' }))).toBeUndefined(); // no expiry
  });

  it('reads names with accents and symbols', () => {
    const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ sub: 'u', name: 'José Ñandú', exp: 1 })))).replace(/=+$/, '');
    expect(claimsOf(`x.${payload}.y`)?.name).toBe('José Ñandú');
  });
});

describe('exchangeCode and refreshTokens', () => {
  const claims = { sub: 'u1', name: 'Ann', exp: 2_000_000 };

  it('trades the code and secret for tokens, expiring when the ID token does', async () => {
    let sent = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = init.body as string;
      return json({ id_token: idToken(claims), refresh_token: 'r1', expires_in: 5 });
    }) as unknown as typeof fetch;
    const result = await exchangeCode({ tokenEndpoint: 'https://id.example/token', clientId: 'app', redirectUri: 'https://x/cb', code: 'c', verifier: 'v' }, fetchImpl);
    expect(Object.fromEntries(new URLSearchParams(sent))).toMatchObject({ grant_type: 'authorization_code', code: 'c', code_verifier: 'v', client_id: 'app' });
    expect(result).toEqual({ idToken: idToken(claims), refreshToken: 'r1', expiresAt: 2_000_000_000 });
  });

  it('keeps the old refresh token when the provider sends none', async () => {
    const fetchImpl = (async () => json({ id_token: idToken(claims) })) as unknown as typeof fetch;
    const result = await refreshTokens({ tokenEndpoint: 'https://id.example/token', clientId: 'app', refreshToken: 'old' }, fetchImpl);
    expect(result.refreshToken).toBe('old');
  });

  it('fails clearly when the provider refuses or sends nothing usable', async () => {
    await expect(exchangeCode({ tokenEndpoint: 'x', clientId: 'a', redirectUri: 'r', code: 'c', verifier: 'v' }, (async () => json({}, 400)) as unknown as typeof fetch)).rejects.toThrow(/refused/);
    await expect(refreshTokens({ tokenEndpoint: 'x', clientId: 'a', refreshToken: 'r' }, (async () => json({ id_token: 'junk' })) as unknown as typeof fetch)).rejects.toThrow(/usable/);
  });
});

describe('needsRefresh', () => {
  it('renews a token a minute before it runs out', () => {
    expect(needsRefresh(100_000, 30_000)).toBe(false);
    expect(needsRefresh(100_000, 45_000)).toBe(true);
    expect(needsRefresh(100_000, 200_000)).toBe(true);
  });
});
