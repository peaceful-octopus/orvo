import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

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
export function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export const MIN_METRICS_TOKEN_LENGTH = 16;

export interface MetricsRequest {
  headers: Record<string, unknown>;
  /** The socket's address, not the one a proxy reports. */
  remoteAddress: string | undefined;
}

/**
 * Who may read `/metrics`. With a token, whoever presents it as a bearer token, from anywhere. Without one, only
 * requests from the local network that did not come through a proxy, so exposing a service through a reverse proxy
 * does not publish its metrics.
 */
export function metricsAllowed(req: MetricsRequest, token: string | undefined): boolean {
  if (token) {
    const header = req.headers.authorization;
    return secretMatches(/^Bearer\s+(.+)$/i.exec(typeof header === 'string' ? header : '')?.[1], token);
  }
  return !cameThroughProxy(req.headers) && isLocalAddress(req.remoteAddress);
}

export function checkMetricsToken(token: string | undefined): void {
  if (token !== undefined && token !== '' && token.length < MIN_METRICS_TOKEN_LENGTH) {
    throw new Error(`METRICS_TOKEN must be at least ${MIN_METRICS_TOKEN_LENGTH} characters.`);
  }
}

export const METRICS_REFUSED = {
  error: 'Metrics are served to the local network only. Set METRICS_TOKEN and send it as a bearer token to read them from elsewhere.',
  code: 'metrics-forbidden',
};
