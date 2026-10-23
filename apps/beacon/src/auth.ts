import { createRemoteJWKSet, jwtVerify } from 'jose';

/** A signed-in person, as the beacon knows them. Guests have no identity. */
export interface Identity {
  /** Stable and unique across providers: the provider's address and the account's id there. */
  id: string;
  name?: string;
}

/** Decides whether a bearer token is acceptable and who it belongs to; returns undefined for any token it rejects. */
export type AuthVerifier = (token: string) => Promise<Identity | undefined>;

/** Everything needed to let people sign in; published to clients, so none of it is secret. */
export interface AuthOptions {
  verify: AuthVerifier;
  issuer: string;
  /** The id this app is registered under at the provider. */
  clientId: string;
  scope?: string;
}

export interface OidcOptions {
  /** The provider's address, as it appears in its tokens (`iss`). Its keys are found through discovery. */
  issuer: string;
  /** What the tokens are meant for: the app's client id at the provider. */
  audience: string;
  /** Allowed difference between the provider's clock and ours. */
  clockToleranceSec?: number;
}

/**
 * Verifies ID tokens from any OpenID Connect provider: the signature against the provider's published keys, and that
 * the token is unexpired, from this issuer and meant for this app. Discovery runs on first use and is retried if it
 * fails, so the beacon can start before the provider is reachable.
 */
export function createOidcVerifier(opts: OidcOptions): AuthVerifier {
  let keys: ReturnType<typeof createRemoteJWKSet> | undefined;

  const discover = async () => {
    const res = await fetch(`${opts.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`discovery failed (${res.status})`);
    const { jwks_uri } = (await res.json()) as { jwks_uri?: string };
    if (!jwks_uri) throw new Error('the provider publishes no jwks_uri');
    return createRemoteJWKSet(new URL(jwks_uri));
  };

  return async (token) => {
    try {
      keys ??= await discover();
      const { payload } = await jwtVerify(token, keys, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms: ['RS256', 'RS384', 'RS512', 'PS256', 'ES256', 'ES384', 'EdDSA'],
        clockTolerance: opts.clockToleranceSec ?? 30,
      });
      if (typeof payload.sub !== 'string' || !payload.sub) return undefined;
      const name = [payload.name, payload.preferred_username, payload.email].find((v) => typeof v === 'string' && v) as string | undefined;
      return { id: `${payload.iss}|${payload.sub}`, name };
    } catch (err) {
      // A bad token is routine. A provider we could not reach is worth trying again on the next request.
      if (err instanceof TypeError || (err instanceof Error && /discovery|jwks/i.test(err.message))) keys = undefined;
      return undefined;
    }
  };
}
