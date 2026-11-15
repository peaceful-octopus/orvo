import { create } from 'zustand';
import { getServerUrl } from '../config';
import { useConfig } from '../configStore';
import { inTauri, isAndroid } from '../platform';
import { authorizeUrl, claimsOf, createPkce, discover, exchangeCode, needsRefresh, randomString, refreshTokens, type Endpoints, type TokenSet } from './oidc';

const SESSION_KEY = 'orvo:auth';
const PENDING_KEY = 'orvo:auth-pending';
const ANDROID_PENDING_KEY = 'orvo:auth-pending-android';

export interface User {
  sub: string;
  name?: string;
  email?: string;
}

interface Session {
  tokens: TokenSet;
  user: User;
  /**
   * The server and sign-in provider these tokens were issued for. The ID token is a bearer credential for that server,
   * and the refresh token (and client secret) belong to that provider, so neither is ever sent anywhere else.
   */
  server: string;
  issuer: string;
}

/** What is kept in local storage. */
interface Stored extends TokenSet {
  server?: string;
  issuer?: string;
}

interface Pending {
  state: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  /** Where to go once signed in: the page the person was on. */
  returnTo: string;
}

interface AuthState {
  session?: Session;
  /** True while the person is signing in in their browser and the app waits for them to come back (desktop app). */
  waiting: boolean;
  /** Sends the person to the provider to sign in. Comes back through `completeSignIn`. */
  signIn(): Promise<void>;
  /** Finishes signing in from the address the provider sent the person back to; resolves to where they were. */
  completeSignIn(callbackUrl: string): Promise<string>;
  /** The shared end of both ways of signing in: checks the answer against what was asked and stores the tokens. */
  finish(pending: Pending | undefined, callbackUrl: string): Promise<string>;
  signOut(): void;
  /** A valid ID token for the beacon, renewed when it is about to run out; undefined for a guest. */
  token(): Promise<string | undefined>;
}

function load(): Session | undefined {
  try {
    const { server, issuer, ...tokens } = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Stored;
    const claims = claimsOf(tokens.idToken);
    // A token that ran out with no way to renew it is a signed-out person, not a half signed-in one. One that does not
    // say which server it is for (saved by an older version) or is for another server than this one is not used.
    if (!claims || !server || !issuer || server !== getServerUrl() || (tokens.expiresAt <= Date.now() && !tokens.refreshToken)) return undefined;
    return { tokens, server, issuer, user: { sub: claims.sub, name: claims.name, email: claims.email } };
  } catch {
    return undefined;
  }
}

function save(session: Pick<Session, 'tokens' | 'server' | 'issuer'> | undefined) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session.tokens, server: session.server, issuer: session.issuer }));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Without storage the person stays signed in until the page closes.
  }
}

/** The sign-in settings for this app: the desktop and Android apps use their own client when the server has one. */
const providerConfig = () => {
  const auth = useConfig.getState().config.auth;
  if (!auth) return undefined;
  const client: { clientId: string; clientSecret?: string } = isAndroid ? (auth.android ?? auth) : inTauri && auth.desktop ? auth.desktop : auth;
  return {
    issuer: auth.issuer,
    scope: auth.scope,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    offline: new URL(auth.issuer).hostname === 'accounts.google.com',
  };
};

/**
 * Where the provider sends the person back to on Android: an address only this app answers to, named after its package
 * (the form Google accepts for Android clients, and one any other provider can register).
 */
const ANDROID_REDIRECT = 'dev.orvo.app:/oauth2redirect';
const isAndroidRedirect = (url: string) => url.startsWith(ANDROID_REDIRECT);

let endpoints: { issuer: string; value: Promise<Endpoints> } | undefined;
const endpointsFor = (issuer: string) => {
  if (endpoints?.issuer !== issuer) {
    const value = discover(issuer);
    value.catch(() => (endpoints = undefined)); // try again next time if the provider was unreachable
    endpoints = { issuer, value };
  }
  return endpoints.value;
};

let refreshing: Promise<string | undefined> | undefined;

/**
 * The desktop app signs in through the system browser. A short-lived listener on this machine (see `oauth_listen` in
 * the Rust side) catches the provider's redirect and hands the address back here.
 */
async function signInInBrowser(authorization: string, config: NonNullable<ReturnType<typeof providerConfig>>): Promise<string> {
  const [{ invoke }, { listen }, { openUrl }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/plugin-opener'),
  ]);
  const port = await invoke<number>('oauth_listen');
  const { verifier, challenge } = await createPkce();
  const pending: Pending = { state: randomString(), verifier, nonce: randomString(), redirectUri: `http://127.0.0.1:${port}/callback`, returnTo: '' };
  const back = new Promise<string>((resolve) => void listen<string>('oauth-callback', (e) => resolve(`http://127.0.0.1:${port}${e.payload}`)).then(() => undefined));
  await openUrl(authorizeUrl({ endpoint: authorization, clientId: config.clientId, redirectUri: pending.redirectUri, scope: config.scope, state: pending.state, challenge, nonce: pending.nonce, offline: config.offline }));
  return useAuth.getState().finish(pending, await back);
}

/**
 * The Android app signs in through the system browser too, but cannot listen on a port. The provider sends the browser
 * to `ANDROID_REDIRECT`, which Android hands to this app as a deep link. The sign-in in progress is kept in local
 * storage because Android may stop the app while the person is in their browser.
 */
async function signInOnAndroid(authorization: string, config: NonNullable<ReturnType<typeof providerConfig>>): Promise<string> {
  const [{ onOpenUrl }, { openUrl }] = await Promise.all([import('@tauri-apps/plugin-deep-link'), import('@tauri-apps/plugin-opener')]);
  const { verifier, challenge } = await createPkce();
  const pending: Pending = { state: randomString(), verifier, nonce: randomString(), redirectUri: ANDROID_REDIRECT, returnTo: '' };
  localStorage.setItem(ANDROID_PENDING_KEY, JSON.stringify(pending));
  let arrived!: (url: string) => void;
  const back = new Promise<string>((resolve) => (arrived = resolve));
  const stopListening = await onOpenUrl((urls) => {
    const url = urls.find(isAndroidRedirect);
    if (url) arrived(url);
  });
  await openUrl(authorizeUrl({ endpoint: authorization, clientId: config.clientId, redirectUri: pending.redirectUri, scope: config.scope, state: pending.state, challenge, nonce: pending.nonce, offline: config.offline }));
  const url = await back;
  stopListening();
  localStorage.removeItem(ANDROID_PENDING_KEY);
  return useAuth.getState().finish(pending, url);
}

/** Android may have restarted the app while the person signed in; finishes that sign-in from the link it was started with. */
export async function resumeAndroidSignIn(): Promise<void> {
  const raw = localStorage.getItem(ANDROID_PENDING_KEY);
  if (!isAndroid || !raw) return;
  const { getCurrent } = await import('@tauri-apps/plugin-deep-link');
  const url = (await getCurrent())?.find(isAndroidRedirect);
  localStorage.removeItem(ANDROID_PENDING_KEY);
  if (url) await useAuth.getState().finish(JSON.parse(raw) as Pending, url);
}

export const useAuth = create<AuthState>((set, get) => ({
  session: load(),
  waiting: false,

  async signIn() {
    const config = providerConfig();
    if (!config) throw new Error('This server does not offer sign-in.');
    const { authorization } = await endpointsFor(config.issuer);
    if (inTauri) {
      set({ waiting: true });
      try {
        await (isAndroid ? signInOnAndroid : signInInBrowser)(authorization, config);
      } finally {
        set({ waiting: false });
      }
      return;
    }
    const { verifier, challenge } = await createPkce();
    const pending: Pending = {
      state: randomString(),
      verifier,
      nonce: randomString(),
      redirectUri: `${location.origin}/auth/callback`,
      returnTo: location.pathname + location.search,
    };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    location.assign(
      authorizeUrl({ endpoint: authorization, clientId: config.clientId, redirectUri: pending.redirectUri, scope: config.scope, state: pending.state, challenge, nonce: pending.nonce, offline: config.offline }),
    );
  },

  async completeSignIn(callbackUrl) {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return get().finish(raw ? (JSON.parse(raw) as Pending) : undefined, callbackUrl);
  },

  async finish(pending, callbackUrl) {
    const config = providerConfig();
    const params = new URL(callbackUrl).searchParams;
    if (!config || !pending) throw new Error('This sign-in was not started here. Try signing in again.');
    if (params.get('error')) throw new Error(params.get('error_description') ?? 'The provider did not sign you in.');
    const code = params.get('code');
    if (!code || params.get('state') !== pending.state) throw new Error('The sign-in did not match the one that was started. Try again.');

    const { token } = await endpointsFor(config.issuer);
    const tokens = await exchangeCode({ tokenEndpoint: token, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: pending.redirectUri, code, verifier: pending.verifier });
    const claims = claimsOf(tokens.idToken)!;
    if (claims.nonce !== pending.nonce) throw new Error('The sign-in response was not meant for this request.');
    const session = { tokens, server: getServerUrl(), issuer: config.issuer };
    save(session);
    set({ session: { ...session, user: { sub: claims.sub, name: claims.name, email: claims.email } } });
    return pending.returnTo;
  },

  signOut() {
    save(undefined);
    set({ session: undefined });
  },

  async token() {
    const session = get().session;
    if (!session) return undefined;
    // Signed in for another server or provider than the one in use now (the server setting changed): act as a guest and
    // keep the session, which is valid again if the person switches back.
    if (session.server !== getServerUrl() || session.issuer !== providerConfig()?.issuer) return undefined;
    if (!needsRefresh(session.tokens.expiresAt, Date.now())) return session.tokens.idToken;
    refreshing ??= (async () => {
      try {
        const config = providerConfig();
        if (!config || !session.tokens.refreshToken) throw new Error('cannot renew');
        const { token } = await endpointsFor(config.issuer);
        const tokens = await refreshTokens({ tokenEndpoint: token, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: session.tokens.refreshToken });
        save({ ...session, tokens });
        set({ session: { ...session, tokens } });
        return tokens.idToken;
      } catch {
        // Not being able to renew means the person has to sign in again; carry on as a guest meanwhile.
        get().signOut();
        return undefined;
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  },
}));
