import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

/**
 * A tiny OpenID Connect provider for tests: discovery, signing keys, an authorization endpoint that approves at
 * once, and a token endpoint that checks PKCE. The person who "signs in" is named by `login_hint`, so a test can
 * choose who it is with `?login_hint=ann`. Never use it outside tests.
 */
export interface FakeIdp {
  issuer: string;
  clientId: string;
  port: number;
  /** Signs an ID token as this provider would. Claims override the defaults; `expiresInSec` may be negative. */
  sign(claims?: Record<string, unknown>, opts?: { expiresInSec?: number; audience?: string; issuer?: string }): Promise<string>;
  close(): Promise<void>;
}

interface Pending {
  user: string;
  challenge: string;
  redirectUri: string;
  nonce?: string;
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

/**
 * `host` is the address to listen on (use 0.0.0.0 so a container can reach it) and `issuer` the address clients are told
 * to use (for example http://host.docker.internal:9190); they default to 127.0.0.1 and the address it listens on.
 */
export async function startFakeIdp(opts: { port?: number; clientId?: string; tokenTtlSec?: number; host?: string; issuer?: string } = {}): Promise<FakeIdp> {
  const clientId = opts.clientId ?? 'orvo-test';
  const ttl = opts.tokenTtlSec ?? 3600;
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'fake-1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, Pending>();
  const refreshTokens = new Map<string, string>();
  /** Who signs in next when the request does not say: tests change it with GET /__user?name=bob. */
  let nextUser = 'ann';

  let issuer = '';
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', issuer || 'http://127.0.0.1');
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...cors, ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }

    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (url.pathname === '/__user') {
      nextUser = (url.searchParams.get('name') ?? 'ann').toLowerCase();
      return send(200, { user: nextUser });
    }

    if (url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri');
      const challenge = url.searchParams.get('code_challenge');
      if (url.searchParams.get('client_id') !== clientId || !redirectUri || !challenge) return send(400, { error: 'invalid_request' });
      const code = randomBytes(12).toString('hex');
      codes.set(code, { user: url.searchParams.get('login_hint') ?? nextUser, challenge, redirectUri, nonce: url.searchParams.get('nonce') ?? undefined });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      const state = url.searchParams.get('state');
      if (state) back.searchParams.set('state', state);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      let user: string | undefined;
      let nonce: string | undefined;
      if (form.get('grant_type') === 'authorization_code') {
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const matches = pending && createHash('sha256').update(verifier).digest('base64url') === pending.challenge;
        if (!pending || !matches || form.get('redirect_uri') !== pending.redirectUri) return send(400, { error: 'invalid_grant' });
        user = pending.user;
        nonce = pending.nonce;
      } else if (form.get('grant_type') === 'refresh_token') {
        user = refreshTokens.get(form.get('refresh_token') ?? '');
        if (!user) return send(400, { error: 'invalid_grant' });
      } else {
        return send(400, { error: 'unsupported_grant_type' });
      }
      const refresh = randomBytes(12).toString('hex');
      refreshTokens.set(refresh, user);
      const idToken = await sign({ sub: `user-${user}`, name: user[0]!.toUpperCase() + user.slice(1), email: `${user}@example.test`, ...(nonce ? { nonce } : {}) });
      return send(200, { token_type: 'Bearer', access_token: 'opaque-access-token', id_token: idToken, refresh_token: refresh, expires_in: ttl });
    }

    return send(404, { error: 'not_found' });
  });

  async function sign(claims: Record<string, unknown> = {}, o: { expiresInSec?: number; audience?: string; issuer?: string } = {}) {
    return new SignJWT({ sub: 'user-ann', name: 'Ann', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'fake-1' })
      .setIssuer(o.issuer ?? issuer)
      .setAudience(o.audience ?? clientId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (o.expiresInSec ?? ttl))
      .sign(privateKey);
  }

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  issuer = opts.issuer ?? `http://127.0.0.1:${port}`;

  return {
    issuer,
    clientId,
    port,
    sign,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
