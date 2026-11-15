import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (exp: number) => `${b64({ alg: 'RS256' })}.${b64({ sub: 'u1', name: 'Ada', exp })}.sig`;

const SERVER = 'https://orvo.example.com';
const ISSUER = 'https://id.example.com';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Loads the store as a page would, with `stored` already in local storage and `server` as the chosen server. */
async function open(stored: object | undefined, server = SERVER) {
  vi.resetModules();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', memoryStorage({ 'orvo:server': server, ...(stored ? { 'orvo:auth': JSON.stringify(stored) } : {}) }));
  vi.stubGlobal('sessionStorage', memoryStorage());
  const { useAuth } = await import('./authStore');
  const { useConfig } = await import('../configStore');
  useConfig.setState({ config: { ...useConfig.getState().config, auth: { issuer: ISSUER, clientId: 'orvo', scope: 'openid', createRequiresLogin: false } } });
  return useAuth;
}

const session = (extra: object = {}) => ({ idToken: idToken(Math.floor(Date.now() / 1000) + 3600), expiresAt: Date.now() + 3600_000, refreshToken: 'r1', server: SERVER, issuer: ISSUER, ...extra });

describe('a saved sign-in', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('is used for the server and provider it was issued for', async () => {
    const auth = await open(session());
    expect(auth.getState().session?.user.name).toBe('Ada');
    expect(await auth.getState().token()).toBeTruthy();
  });

  it('is not loaded when the server is another one', async () => {
    const auth = await open(session(), 'https://other.example.com');
    expect(auth.getState().session).toBeUndefined();
  });

  it('is not loaded when it does not say which server it is for', async () => {
    const old: Partial<ReturnType<typeof session>> = session();
    delete old.server;
    delete old.issuer;
    expect((await open(old)).getState().session).toBeUndefined();
  });

  it('is never sent as a bearer token once the provider differs, and no refresh goes to the other provider', async () => {
    const fetch = vi.fn();
    const auth = await open(session({ issuer: 'https://evil.example.com', expiresAt: Date.now() - 1000 }));
    vi.stubGlobal('fetch', fetch);
    expect(await auth.getState().token()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
