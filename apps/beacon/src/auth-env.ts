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
 *   OIDC_AUDIENCE                  what tokens must be meant for (default: the client id)
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
  const auth = issuer && clientId
    ? { verify: createOidcVerifier({ issuer, audience: env.OIDC_AUDIENCE || clientId }), issuer, clientId, scope: env.OIDC_SCOPE || undefined }
    : undefined;
  return { auth, roomCreation, defaultRoomAccess };
}
