import { startFakeIdp, type FakeIdp } from '@orvo/testkit/src/fake-idp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOidcVerifier } from './auth';
import { authSettingsFromEnv } from './auth-env';

let idp: FakeIdp;
beforeAll(async () => {
  idp = await startFakeIdp({ clientId: 'orvo-test' });
});
afterAll(() => idp.close());

describe('createOidcVerifier', () => {
  const verifier = () => createOidcVerifier({ issuer: idp.issuer, audience: idp.clientId });

  it('accepts a token from the provider and names the person', async () => {
    const identity = await verifier()(await idp.sign({ sub: 'u1', name: 'Ann Lee' }));
    expect(identity).toEqual({ id: `${idp.issuer}|u1`, name: 'Ann Lee' });
  });

  it('falls back to the username or email when there is no name', async () => {
    expect((await verifier()(await idp.sign({ sub: 'u2', name: undefined, preferred_username: 'ann' })))?.name).toBe('ann');
    expect((await verifier()(await idp.sign({ sub: 'u3', name: undefined, email: 'a@example.test' })))?.name).toBe('a@example.test');
  });

  it('rejects expired tokens, wrong audiences, wrong issuers, garbage and tokens signed by someone else', async () => {
    const verify = verifier();
    expect(await verify(await idp.sign({}, { expiresInSec: -120 }))).toBeUndefined();
    expect(await verify(await idp.sign({}, { audience: 'some-other-app' }))).toBeUndefined();
    expect(await verify(await idp.sign({}, { issuer: 'https://evil.example' }))).toBeUndefined();
    expect(await verify('not.a.token')).toBeUndefined();
    expect(await verify('')).toBeUndefined();

    const other = await startFakeIdp({ clientId: 'orvo-test' });
    try {
      // Same client id and issuer claim, but a different key pair.
      const forged = await other.sign({}, { issuer: idp.issuer });
      expect(await verify(forged)).toBeUndefined();
    } finally {
      await other.close();
    }
  });

  it('keeps working after the provider was unreachable at first', async () => {
    const port = idp.port + 1;
    const verify = createOidcVerifier({ issuer: `http://127.0.0.1:${port}`, audience: 'x' });
    expect(await verify(await idp.sign())).toBeUndefined(); // nothing is listening there yet
    const late = await startFakeIdp({ port, clientId: 'x' });
    try {
      expect((await verify(await late.sign({ sub: 'u9' })))?.id).toBe(`${late.issuer}|u9`);
    } finally {
      await late.close();
    }
  });
});

describe('authSettingsFromEnv', () => {
  it('means everyone is a guest when nothing is set', () => {
    expect(authSettingsFromEnv({})).toMatchObject({ auth: undefined, roomCreation: 'anyone', defaultRoomAccess: 'anyone' });
  });

  it('turns sign-in on from the issuer and client id, with the audience defaulting to the client id', () => {
    const s = authSettingsFromEnv({ OIDC_ISSUER: 'https://id.example', OIDC_CLIENT_ID: 'app', ROOM_CREATION: 'signed-in', DEFAULT_ROOM_ACCESS: 'signed-in' });
    expect(s.auth).toMatchObject({ issuer: 'https://id.example', clientId: 'app' });
    expect(s).toMatchObject({ roomCreation: 'signed-in', defaultRoomAccess: 'signed-in' });
  });

  it('refuses half a setup, unknown values, and requiring sign-in with no provider', () => {
    expect(() => authSettingsFromEnv({ OIDC_ISSUER: 'https://id.example' })).toThrow(/both/);
    expect(() => authSettingsFromEnv({ OIDC_CLIENT_ID: 'app' })).toThrow(/both/);
    expect(() => authSettingsFromEnv({ ROOM_CREATION: 'sometimes' })).toThrow(/anyone/);
    expect(() => authSettingsFromEnv({ ROOM_CREATION: 'signed-in' })).toThrow(/OIDC_ISSUER/);
    expect(() => authSettingsFromEnv({ DEFAULT_ROOM_ACCESS: 'signed-in' })).toThrow(/OIDC_ISSUER/);
  });
});
