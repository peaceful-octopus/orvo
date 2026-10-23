import { createOidcVerifier, type AuthOptions } from './auth';

export interface AuthSettings {
  auth?: AuthOptions;
  roomCreation: 'anyone' | 'signed-in';
  defaultRoomAccess: 'anyone' | 'signed-in';
}

const choice = (name: string, value: string | undefined): 'anyone' | 'signed-in' => {
  if (!value) return 'anyone';
  if (value === 'anyone' || value === 'signed-in') return value;
  throw new Error(`${name} must be "anyone" or "signed-in", not "${value}".`);
};

/**
 * Reads the sign-in settings from the environment:
 *   OIDC_ISSUER, OIDC_CLIENT_ID    an OpenID Connect provider and this app's id there; both turn sign-in on
 *   OIDC_CLIENT_SECRET             for providers that require one even with PKCE (Google); published to every client
 *   OIDC_DESKTOP_CLIENT_ID         the desktop app's own client, when the provider needs a separate one (Google)
 *   OIDC_DESKTOP_CLIENT_SECRET     that client's secret, if it has one
 *   OIDC_AUDIENCE                  what tokens must be meant for (default: the client id, and the desktop client id)
 *   OIDC_SCOPE                     scopes the app asks for (default: openid profile email)
 *   ROOM_CREATION                  `anyone` (default) or `signed-in`: who may start a room
 *   DEFAULT_ROOM_ACCESS            `anyone` (default) or `signed-in`: who may join a room unless its creator chose otherwise
 */
export function authSettingsFromEnv(env: Record<string, string | undefined>): AuthSettings {
  const { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId } = env;
  if (Boolean(issuer) !== Boolean(clientId)) throw new Error('Set both OIDC_ISSUER and OIDC_CLIENT_ID, or neither.');
  const roomCreation = choice('ROOM_CREATION', env.ROOM_CREATION);
  const defaultRoomAccess = choice('DEFAULT_ROOM_ACCESS', env.DEFAULT_ROOM_ACCESS);
  if (!issuer && (roomCreation === 'signed-in' || defaultRoomAccess === 'signed-in')) {
    throw new Error('ROOM_CREATION and DEFAULT_ROOM_ACCESS can only require sign-in when OIDC_ISSUER and OIDC_CLIENT_ID are set.');
  }
  const { OIDC_CLIENT_SECRET: clientSecret, OIDC_DESKTOP_CLIENT_ID: desktopId, OIDC_DESKTOP_CLIENT_SECRET: desktopSecret } = env;
  if (!issuer && (clientSecret || desktopId || desktopSecret)) {
    throw new Error('OIDC_CLIENT_SECRET and the OIDC_DESKTOP_* settings need OIDC_ISSUER and OIDC_CLIENT_ID.');
  }
  if (desktopSecret && !desktopId) throw new Error('OIDC_DESKTOP_CLIENT_SECRET needs OIDC_DESKTOP_CLIENT_ID.');
  const auth =
    issuer && clientId
      ? {
          verify: createOidcVerifier({ issuer, audience: env.OIDC_AUDIENCE || (desktopId ? [clientId, desktopId] : clientId) }),
          issuer,
          clientId,
          clientSecret: clientSecret || undefined,
          desktop: desktopId ? { clientId: desktopId, clientSecret: desktopSecret || undefined } : undefined,
          scope: env.OIDC_SCOPE || undefined,
        }
      : undefined;
  return { auth, roomCreation, defaultRoomAccess };
}
