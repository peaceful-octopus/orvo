/**
 * Signing in with an OpenID Connect provider: the authorization-code flow with PKCE, which needs no client secret.
 * The functions here are plain and take `fetch` as a parameter so they can be tested without a provider.
 */

export interface Endpoints {
  authorization: string;
  token: string;
}

export interface TokenSet {
  /** What is sent to the server as the bearer token. */
  idToken: string;
  refreshToken?: string;
  /** When the ID token stops being accepted, in milliseconds. */
  expiresAt: number;
}

export interface Claims {
  sub: string;
  name?: string;
  email?: string;
  exp: number;
  nonce?: string;
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomString(bytes = 24): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** A one-time secret and its SHA-256 fingerprint: the provider only releases tokens to whoever holds the secret. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export async function discover(issuer: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<Endpoints> {
  const res = await fetchImpl(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`The sign-in provider did not answer (${res.status}).`);
  const doc = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
  if (!doc.authorization_endpoint || !doc.token_endpoint) throw new Error('The sign-in provider is missing its endpoints.');
  return { authorization: doc.authorization_endpoint, token: doc.token_endpoint };
}

export interface AuthorizeParams {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  challenge: string;
  nonce: string;
}

export function authorizeUrl(p: AuthorizeParams): string {
  const url = new URL(p.endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', p.state);
  url.searchParams.set('nonce', p.nonce);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Reads what an ID token says, for showing a name. It is not checked here: the server checks it on every request. */
export function claimsOf(idToken: string): Claims | undefined {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const json = new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
    const claims = JSON.parse(json) as Partial<Claims>;
    return typeof claims.sub === 'string' && typeof claims.exp === 'number' ? (claims as Claims) : undefined;
  } catch {
    return undefined;
  }
}

async function tokens(res: Response): Promise<TokenSet> {
  if (!res.ok) throw new Error(`The sign-in provider refused the request (${res.status}).`);
  const body = (await res.json()) as { id_token?: string; refresh_token?: string };
  const claims = body.id_token ? claimsOf(body.id_token) : undefined;
  if (!body.id_token || !claims) throw new Error('The sign-in provider sent no usable identity.');
  return { idToken: body.id_token, refreshToken: body.refresh_token, expiresAt: claims.exp * 1000 };
}

const form = (values: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(values).toString(),
});

export async function exchangeCode(
  p: { tokenEndpoint: string; clientId: string; redirectUri: string; code: string; verifier: string },
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<TokenSet> {
  return tokens(
    await fetchImpl(
      p.tokenEndpoint,
      form({ grant_type: 'authorization_code', client_id: p.clientId, redirect_uri: p.redirectUri, code: p.code, code_verifier: p.verifier }),
    ),
  );
}

export async function refreshTokens(
  p: { tokenEndpoint: string; clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<TokenSet> {
  const next = await tokens(await fetchImpl(p.tokenEndpoint, form({ grant_type: 'refresh_token', client_id: p.clientId, refresh_token: p.refreshToken })));
  // Some providers send a new refresh token and some keep the old one.
  return { ...next, refreshToken: next.refreshToken ?? p.refreshToken };
}

/** A token is renewed a little before it runs out, so a request in flight never carries an expired one. */
export const needsRefresh = (expiresAt: number, now: number, skewMs = 60_000) => expiresAt - now <= skewMs;
