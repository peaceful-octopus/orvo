import { getServerUrl } from './config';

const TOKEN_KEY = 'orvo:admin-token';

/** The login lasts for the tab, not longer: it is kept in session storage and never in local storage. */
export const adminToken = {
  get(): string | undefined {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(token: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Without storage the login is lost on reload, which is harmless.
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing to clear.
    }
  },
};

export interface AdminResponse {
  status: number;
  body: unknown;
}

/** A request to the server's admin API. Throws only when the server cannot be reached at all. */
export async function adminRequest(method: 'GET' | 'POST' | 'PATCH', path: string, options: { body?: unknown; token?: string } = {}): Promise<AdminResponse> {
  const res = await fetch(new URL(`/v1/admin${path}`, getServerUrl()), {
    method,
    headers: { ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}
