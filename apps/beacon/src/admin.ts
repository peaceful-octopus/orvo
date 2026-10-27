import { fromBase64Url, toBase64Url } from '@orvo/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { SigningKey } from './keys';
import { SECRET_KEYS, SETTING_KEYS, type SettingsStore } from './settings';

const TOKEN_TTL_MS = 8 * 3600_000;
const FAILED_LOGINS_PER_MINUTE = 5;
const FAILED_LOGIN_WINDOW_MS = 60_000;
const MAX_TRACKED_ADDRESSES = 1000;

/** Headers a reverse proxy adds. A request carrying one came from outside, however local the proxy itself is. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip'];

export function cameThroughProxy(headers: Record<string, unknown>): boolean {
  return PROXY_HEADERS.some((name) => headers[name] !== undefined);
}

/** Loopback, private (RFC 1918), link-local and IPv6 unique-local addresses, including IPv4 addresses written as IPv6. */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  const bare = address.replace(/^::ffff:/i, '');
  if (isIP(bare) === 4) {
    const [a, b] = bare.split('.').map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(bare) === 6) {
    const first = bare.toLowerCase().split(':')[0] ?? '';
    if (bare === '::1') return true;
    const high = parseInt(first || '0', 16);
    return (high & 0xfe00) === 0xfc00 || (high & 0xffc0) === 0xfe80;
  }
  return false;
}

/** Hashes first so the comparison takes the same time whatever the lengths. */
export function passwordMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** Tokens are bound to the server's key and the current password, so changing either one ends every session. */
function tokenKey(signingKey: SigningKey, password: string): Buffer {
  return createHmac('sha256', Buffer.from(signingKey.secretKey)).update(`orvo-admin:${password}`).digest();
}

export function issueAdminToken(signingKey: SigningKey, password: string, nowMs: number): { token: string; expiresAt: number } {
  const expiresAt = nowMs + TOKEN_TTL_MS;
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ exp: expiresAt })));
  const sig = toBase64Url(createHmac('sha256', tokenKey(signingKey, password)).update(payload).digest());
  return { token: `${payload}.${sig}`, expiresAt };
}

export function adminTokenValid(token: string | undefined, signingKey: SigningKey, password: string, nowMs: number): boolean {
  const [payload, sig, ...rest] = (token ?? '').split('.');
  if (!payload || !sig || rest.length > 0) return false;
  const expected = createHmac('sha256', tokenKey(signingKey, password)).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(fromBase64Url(sig));
  } catch {
    return false;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { exp?: unknown };
    return typeof exp === 'number' && exp > nowMs;
  } catch {
    return false;
  }
}

/**
 * Counts wrong passwords per address, so guessing is slow while the operator's own logins never count. After `max` wrong
 * ones within the window further attempts are refused until the window ends, whatever password they carry.
 */
export class FailedLoginLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly now: () => number,
    private readonly windowMs = FAILED_LOGIN_WINDOW_MS,
  ) {}

  blocked(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (entry.resetAt <= this.now()) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.max;
  }

  fail(key: string): void {
    const t = this.now();
    if (this.failures.size >= MAX_TRACKED_ADDRESSES) for (const [k, v] of this.failures) if (v.resetAt <= t) this.failures.delete(k);
    const entry = this.failures.get(key);
    if (entry && entry.resetAt > t) entry.count += 1;
    else this.failures.set(key, { count: 1, resetAt: t + this.windowMs });
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}

export interface AdminOptions {
  store: SettingsStore;
  /** The admin password. The routes exist only when the server has one. */
  password: string;
  signingKey: SigningKey;
  /** Lets requests that arrive through a reverse proxy, or from outside the local network, use the admin routes. */
  allowRemote?: boolean;
  now?: () => number;
  /** Wrong passwords allowed per minute for one address before logins from it are refused; `false` for no limit. */
  failedLoginsPerMinute?: number | false;
}

/** What the admin page shows: each setting's value (secrets only as "set"), its default and where the value comes from. */
export function describeSettings(store: SettingsStore) {
  const current = store.effective();
  const defaults = store.defaults();
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const source = store.isSaved(key) ? 'saved' : 'env';
    settings[key] = SECRET_KEYS.includes(key)
      ? { source, isSet: Boolean(current[key]), defaultIsSet: Boolean(defaults[key]) }
      : { source, value: current[key], default: defaults[key] };
  }
  return { settings, authConfigured: store.authConfigured() };
}

/**
 * The operator's admin API, under /v1/admin. Call it only when an admin password is configured: without one the
 * routes do not exist. Every route is refused unless the request is from the local network (or `allowRemote`), and all
 * but `status` and `login` need the token that `login` hands out.
 */
export async function registerAdminRoutes(app: FastifyInstance, opts: AdminOptions): Promise<void> {
  const now = opts.now ?? Date.now;
  const limiter = opts.failedLoginsPerMinute === false ? undefined : new FailedLoginLimiter(opts.failedLoginsPerMinute ?? FAILED_LOGINS_PER_MINUTE, now);

  await app.register(
    async (admin) => {
      admin.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        // The socket's address, not `req.ip`, which behind a proxy is whatever the proxy said the client's was.
        if (!opts.allowRemote && (cameThroughProxy(req.headers) || !isLocalAddress(req.socket.remoteAddress))) {
          return reply.code(403).send({
            error: 'The admin page is only available from your local network. Open it by the server\'s local address instead of the public one, or set ADMIN_ALLOW_REMOTE=1.',
            code: 'admin-local-only',
          });
        }
      });

      const authorized = (req: FastifyRequest): boolean => {
        const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
        return adminTokenValid(token, opts.signingKey, opts.password, now());
      };
      const needLogin = (reply: FastifyReply) => reply.code(401).send({ error: 'Log in again.', code: 'admin-login-required' });

      admin.get('/status', async () => ({ enabled: true }));

      admin.post('/login', async (req, reply) => {
        if (limiter?.blocked(req.ip)) return reply.code(429).send({ error: 'Too many wrong passwords. Wait a minute and try again.', code: 'admin-too-many-attempts' });
        const { password } = (req.body ?? {}) as { password?: unknown };
        if (!passwordMatches(password, opts.password)) {
          limiter?.fail(req.ip);
          return reply.code(401).send({ error: 'Wrong password.', code: 'admin-wrong-password' });
        }
        limiter?.clear(req.ip);
        return issueAdminToken(opts.signingKey, opts.password, now());
      });

      admin.get('/settings', async (req, reply) => {
        if (!authorized(req)) return needLogin(reply);
        return describeSettings(opts.store);
      });

      admin.patch('/settings', async (req, reply) => {
        if (!authorized(req)) return needLogin(reply);
        const body = req.body as { set?: unknown; reset?: unknown } | null;
        const set = body?.set ?? {};
        const reset = body?.reset ?? [];
        if (typeof set !== 'object' || set === null || Array.isArray(set) || !Array.isArray(reset) || reset.some((k) => typeof k !== 'string')) {
          return reply.code(400).send({ error: 'Invalid request.', code: 'bad-request' });
        }
        const result = opts.store.update({ set: set as Record<string, unknown>, reset: reset as string[] });
        if (!result.ok) return reply.code(400).send({ error: 'Some settings were not accepted.', code: 'bad-settings', errors: result.errors });
        return describeSettings(opts.store);
      });
    },
    { prefix: '/v1/admin' },
  );
}
