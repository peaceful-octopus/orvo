import { create } from 'zustand';
import { useConfig } from '../configStore';
import { authorizeUrl, claimsOf, createPkce, discover, exchangeCode, needsRefresh, randomString, refreshTokens, type Endpoints, type TokenSet } from './oidc';

const SESSION_KEY = 'chillcall:auth';
const PENDING_KEY = 'chillcall:auth-pending';

export interface User {
  sub: string;
  name?: string;
  email?: string;
}

interface Session {
  tokens: TokenSet;
  user: User;
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
  /** Sends the person to the provider to sign in. Comes back through `completeSignIn`. */
  signIn(): Promise<void>;
  /** Finishes signing in from the address the provider sent the person back to; resolves to where they were. */
  completeSignIn(callbackUrl: string): Promise<string>;
  signOut(): void;
  /** A valid ID token for the beacon, renewed when it is about to run out; undefined for a guest. */
  token(): Promise<string | undefined>;
}

function load(): Session | undefined {
  try {
    const tokens = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as TokenSet | null;
    const claims = tokens && claimsOf(tokens.idToken);
    // A token that ran out with no way to renew it is a signed-out person, not a half signed-in one.
    if (!tokens || !claims || (tokens.expiresAt <= Date.now() && !tokens.refreshToken)) return undefined;
    return { tokens, user: { sub: claims.sub, name: claims.name, email: claims.email } };
  } catch {
    return undefined;
  }
}

function save(tokens: TokenSet | undefined) {
  try {
    if (tokens) localStorage.setItem(SESSION_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Without storage the person stays signed in until the page closes.
  }
}

const providerConfig = () => useConfig.getState().config.auth;

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

export const useAuth = create<AuthState>((set, get) => ({
  session: load(),

  async signIn() {
    const config = providerConfig();
    if (!config) throw new Error('This server does not offer sign-in.');
    const { authorization } = await endpointsFor(config.issuer);
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
      authorizeUrl({ endpoint: authorization, clientId: config.clientId, redirectUri: pending.redirectUri, scope: config.scope, state: pending.state, challenge, nonce: pending.nonce }),
    );
  },

  async completeSignIn(callbackUrl) {
    const config = providerConfig();
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const pending = raw ? (JSON.parse(raw) as Pending) : undefined;
    const params = new URL(callbackUrl).searchParams;
    if (!config || !pending) throw new Error('This sign-in was not started here. Try signing in again.');
    if (params.get('error')) throw new Error(params.get('error_description') ?? 'The provider did not sign you in.');
    const code = params.get('code');
    if (!code || params.get('state') !== pending.state) throw new Error('The sign-in did not match the one that was started. Try again.');

    const { token } = await endpointsFor(config.issuer);
    const tokens = await exchangeCode({ tokenEndpoint: token, clientId: config.clientId, redirectUri: pending.redirectUri, code, verifier: pending.verifier });
    const claims = claimsOf(tokens.idToken)!;
    if (claims.nonce !== pending.nonce) throw new Error('The sign-in response was not meant for this request.');
    save(tokens);
    set({ session: { tokens, user: { sub: claims.sub, name: claims.name, email: claims.email } } });
    return pending.returnTo;
  },

  signOut() {
    save(undefined);
    set({ session: undefined });
  },

  async token() {
    const session = get().session;
    if (!session) return undefined;
    if (!needsRefresh(session.tokens.expiresAt, Date.now())) return session.tokens.idToken;
    refreshing ??= (async () => {
      try {
        const config = providerConfig();
        if (!config || !session.tokens.refreshToken) throw new Error('cannot renew');
        const { token } = await endpointsFor(config.issuer);
        const tokens = await refreshTokens({ tokenEndpoint: token, clientId: config.clientId, refreshToken: session.tokens.refreshToken });
        save(tokens);
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
