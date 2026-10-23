import { FakeClock, testKeys } from '@chillcall/testkit';
import { MemoryPlacementStore } from '@chillcall/placement';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyJoinToken } from '@chillcall/protocol';
import { createBeaconApp, type BeaconOptions } from './app';

const key = testKeys('beacon-1');
const clock = new FakeClock();
const nodes = [{ id: 'node-1', region: 'r', weight: 1, draining: false }];

let app: Awaited<ReturnType<typeof createBeaconApp>>;

async function start(extra: Partial<BeaconOptions> = {}) {
  app = await createBeaconApp({
    signingKey: { kid: key.kid, publicKey: key.publicKey, secretKey: key.secretKey },
    store: new MemoryPlacementStore(nodes, () => clock.now),
    stunUrls: ['stun:stun.example.com:3478'],
    now: () => clock.now,
    rateLimitPerMinute: false,
    ...extra,
  });
}

afterEach(() => app.close());

const people: Record<string, { id: string; name: string }> = { 'token-ann': { id: 'ann', name: 'Ann' }, 'token-bob': { id: 'bob', name: 'Bob' } };
const auth = { verify: async (token: string) => people[token], issuer: 'https://id.example', clientId: 'chillcall' };
const as = (token?: string) => ({ host: 'chill.example.com', ...(token ? { authorization: `Bearer ${token}` } : {}) });
const create = (token?: string, body: object = {}) => app.inject({ method: 'POST', url: '/v1/rooms', payload: body, headers: as(token) });
const join = (room: string, token?: string) => app.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room }, headers: as(token) });
const patch = (room: string, body: object, token?: string) => app.inject({ method: 'PATCH', url: `/v1/rooms/${room}`, payload: body, headers: as(token) });
const room = 'quiet-pond-reed-abc12345';

describe('without an identity provider', () => {
  beforeEach(() => start());

  it('lets guests start and join rooms, whatever they send', async () => {
    expect((await create()).statusCode).toBe(200);
    expect((await create('token-ann')).statusCode).toBe(200); // a token sent to a server with no provider is ignored
    expect((await join(room, 'whatever')).statusCode).toBe(200);
  });

  it('publishes no sign-in details', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { host: 'chill.example.com' } });
    expect(res.json().payload.auth).toBeUndefined();
  });

  it('ignores a request for a signed-in-only room, which nobody could ever join', async () => {
    const made = (await create(undefined, { signedInOnly: true })).json();
    expect(made.signedInOnly).toBe(false);
    expect((await join(made.room)).statusCode).toBe(200);
  });
});

describe('startup checks', () => {
  it('refuses a rule that needs sign-in when there is no provider', async () => {
    const base = { signingKey: key, store: new MemoryPlacementStore(nodes), stunUrls: [] };
    await expect(createBeaconApp({ ...base, roomCreation: 'signed-in' })).rejects.toThrow(/identity provider/);
    await expect(createBeaconApp({ ...base, defaultRoomAccess: 'signed-in' })).rejects.toThrow(/identity provider/);
  });
});

describe('when starting a room needs an account', () => {
  beforeEach(() => start({ auth, roomCreation: 'signed-in' }));

  it('publishes how to sign in and that it is needed', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config', headers: { host: 'chill.example.com' } });
    expect(res.json().payload.auth).toEqual({ issuer: 'https://id.example', clientId: 'chillcall', scope: 'openid profile email', createRequiresLogin: true });
  });

  it('turns guests away from starting a room, and from joining a room nobody has started', async () => {
    const res = await create();
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('login-required-to-create');
    const joined = await join(room);
    expect(joined.statusCode).toBe(401);
    expect(joined.json().code).toBe('login-required-to-create');
  });

  it('lets a signed-in person start a room, and guests join it afterwards', async () => {
    const made = (await create('token-ann')).json();
    expect(made.signedInOnly).toBe(false);
    expect((await join(made.room)).statusCode).toBe(200);
  });

  it('lets a signed-in person start a room by joining a new name', async () => {
    expect((await join(room, 'token-ann')).statusCode).toBe(200);
    expect((await join(room)).statusCode).toBe(200); // it exists now, and it is open
  });

  it('rejects a token the provider does not accept, so the client can sign in again', async () => {
    const res = await create('expired-token');
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid-token');
    expect((await join(room, 'expired-token')).json().code).toBe('invalid-token');
  });
});

describe('signed-in-only rooms', () => {
  beforeEach(() => start({ auth }));

  it('admit only signed-in people', async () => {
    const made = (await create('token-ann', { signedInOnly: true })).json();
    expect(made.signedInOnly).toBe(true);
    const guest = await join(made.room);
    expect(guest.statusCode).toBe(401);
    expect(guest.json().code).toBe('login-required-to-join');
    expect((await join(made.room, 'token-bob')).statusCode).toBe(200);
    expect((await join(made.room, 'token-ann')).statusCode).toBe(200);
  });

  it('can be asked for by a guest, which only restricts the room', async () => {
    const made = (await create(undefined, { signedInOnly: true })).json();
    expect(made.signedInOnly).toBe(true);
    expect((await join(made.room)).statusCode).toBe(401);
    expect((await join(made.room, 'token-bob')).statusCode).toBe(200);
  });

  it('can be the default for rooms made by joining, and the creator can opt out', async () => {
    await app.close();
    await start({ auth, defaultRoomAccess: 'signed-in' });
    expect((await join(room, 'token-ann')).statusCode).toBe(200);
    expect((await join(room)).json().code).toBe('login-required-to-join');
    const open = (await create('token-ann', { signedInOnly: false })).json();
    expect((await join(open.room)).statusCode).toBe(200);
  });

  it('are remembered while the room is in use, and forgotten after it has been quiet for a day', async () => {
    const made = (await create('token-ann', { signedInOnly: true })).json();
    clock.advance(23 * 3600_000);
    expect((await join(made.room, 'token-ann')).statusCode).toBe(200); // a join keeps the record alive
    clock.advance(23 * 3600_000);
    expect((await join(made.room)).json().code).toBe('login-required-to-join');
    clock.advance(25 * 3600_000);
    expect((await join(made.room)).statusCode).toBe(200); // gone: the name is free, and guests may start it
  });
});

describe('changing a room afterwards', () => {
  beforeEach(() => start({ auth }));

  it('lets only the signed-in owner change who may join', async () => {
    const made = (await create('token-ann')).json();
    expect((await patch(made.room, { signedInOnly: true }, 'token-ann')).json()).toEqual({ room: made.room, signedInOnly: true, locked: false });
    expect((await join(made.room)).json().code).toBe('login-required-to-join');
    expect((await patch(made.room, { signedInOnly: false }, 'token-ann')).statusCode).toBe(200);
    expect((await join(made.room)).statusCode).toBe(200);
  });

  it('refuses everyone else, with a reason each of them can act on', async () => {
    const made = (await create('token-ann')).json();
    const bob = await patch(made.room, { signedInOnly: true }, 'token-bob');
    expect(bob.statusCode).toBe(403);
    expect(bob.json().code).toBe('not-owner');
    const guest = await patch(made.room, { signedInOnly: true });
    expect(guest.statusCode).toBe(401);
    expect(guest.json().code).toBe('login-required');
    expect((await patch(made.room, { signedInOnly: true }, 'bad')).json().code).toBe('invalid-token');
    expect((await join(made.room)).statusCode).toBe(200); // nothing changed
  });

  it('has no owner to change a room that a guest made, and nothing to change once it is gone', async () => {
    const guestMade = (await create()).json();
    expect((await patch(guestMade.room, { signedInOnly: true }, 'token-ann')).statusCode).toBe(403);
    expect((await patch('no-such-room-xyz12345', { signedInOnly: true }, 'token-ann')).statusCode).toBe(404);
    const mine = (await create('token-ann')).json();
    expect((await patch(mine.room, { nope: 1 }, 'token-ann')).statusCode).toBe(400);
  });
});

describe('plans that come from accounts', () => {
  it('give a signed-in person the plan their account has, with no entitlement token', async () => {
    await start({
      auth,
      turn: { full: { urls: ['turn:t.example.com'], secret: 's' } },
      planFor: async (identity) => (identity.id === 'ann' ? 'full' : undefined),
    });
    const withPlan = (await join(room, 'token-ann')).json();
    expect(withPlan.tier).toBe('full');
    expect(withPlan.iceServers.some((s: { urls: string | string[] }) => String(s.urls).startsWith('turn:'))).toBe(true);
    expect((await join('other-room-abc12345', 'token-bob')).json().tier).toBe('free');
    expect((await join('third-room-abc12345')).json().tier).toBe('free');
  });
});

describe('locking a room', () => {
  beforeEach(() => start({ auth }));

  const joinWith = (roomId: string, token?: string, resume?: string) =>
    app.inject({ method: 'POST', url: '/v1/rooms/join', payload: { room: roomId, resume }, headers: as(token) });

  async function lockedRoomWithMembers() {
    const made = (await create('token-ann')).json();
    const bob = (await joinWith(made.room, 'token-bob')).json(); // Bob and a guest are in before the lock
    const guest = (await joinWith(made.room)).json();
    expect((await patch(made.room, { locked: true }, 'token-ann')).json()).toMatchObject({ locked: true });
    return { room: made.room, bob, guest };
  }

  it('keeps out new people, signed in or not, with a reason that says why', async () => {
    const { room: id } = await lockedRoomWithMembers();
    for (const token of [undefined, 'token-bob']) {
      const res = await joinWith(id, token);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('room-locked');
    }
    expect((await joinWith('other-room-abc12345')).statusCode).toBe(200); // other rooms are not affected
  });

  it('lets people who were already in the room come back, even if they are guests', async () => {
    const { room: id, bob, guest } = await lockedRoomWithMembers();
    expect((await joinWith(id, 'token-bob', bob.resumeToken)).statusCode).toBe(200);
    expect((await joinWith(id, undefined, guest.resumeToken)).statusCode).toBe(200); // a guest reconnecting after a drop
  });

  it('does not accept a resume token from another room, a forged one, or one that ran out', async () => {
    const { room: id, guest } = await lockedRoomWithMembers();
    const elsewhere = (await joinWith('other-room-abc12345')).json();
    expect((await joinWith(id, undefined, elsewhere.resumeToken)).json().code).toBe('room-locked');
    expect((await joinWith(id, undefined, 'forged.token')).json().code).toBe('room-locked');
    clock.advance(7 * 3600_000);
    expect((await joinWith(id, undefined, guest.resumeToken)).json().code).toBe('room-locked');
  });

  it('always lets the owner in, who is then told they own the room', async () => {
    const { room: id } = await lockedRoomWithMembers();
    const res = await joinWith(id, 'token-ann');
    expect(res.statusCode).toBe(200);
    expect(res.json().room).toEqual({ signedInOnly: false, owner: true, locked: true });
  });

  it('opens again when the owner unlocks it', async () => {
    const { room: id } = await lockedRoomWithMembers();
    expect((await patch(id, { locked: false }, 'token-ann')).json().locked).toBe(false);
    expect((await joinWith(id)).statusCode).toBe(200);
  });

  it('can be changed by the owner and by nobody else', async () => {
    const made = (await create('token-ann')).json();
    const bob = await patch(made.room, { locked: true }, 'token-bob');
    expect(bob.statusCode).toBe(403);
    expect(bob.json().code).toBe('not-owner');
    expect((await patch(made.room, { locked: true })).statusCode).toBe(401);
    expect((await joinWith(made.room)).statusCode).toBe(200); // still open
  });

  it('can be combined with signed-in only, and one setting is changed without touching the other', async () => {
    const made = (await create('token-ann', { signedInOnly: true })).json();
    expect((await patch(made.room, { locked: true }, 'token-ann')).json()).toMatchObject({ signedInOnly: true, locked: true });
    expect((await patch(made.room, { signedInOnly: false }, 'token-ann')).json()).toMatchObject({ signedInOnly: false, locked: true });
    expect((await patch(made.room, {}, 'token-ann')).statusCode).toBe(400);
  });

  it('tells the node who owns the room and which account each joiner is, in the signed join token', async () => {
    const made = (await create('token-ann')).json();
    const decode = async (token?: string) => {
      const res = (await joinWith(made.room, token)).json();
      const checked = verifyJoinToken(res.joinToken, { keys: key.keys, nodeId: 'node-1', now: clock.now });
      expect(checked.ok).toBe(true);
      return checked.ok ? checked.payload : undefined;
    };
    expect(await decode('token-ann')).toMatchObject({ owner: true, acct: 'ann' });
    expect(await decode('token-bob')).toMatchObject({ acct: 'bob' });
    expect((await decode('token-bob'))?.owner).toBeUndefined();
    expect(await decode()).toMatchObject({}); // a guest has neither
    expect((await decode())?.acct).toBeUndefined();
  });

  it('remembers the lock while the room is in use', async () => {
    const { room: id } = await lockedRoomWithMembers();
    clock.advance(23 * 3600_000);
    expect((await joinWith(id, 'token-ann')).statusCode).toBe(200); // the owner coming back refreshes the record
    clock.advance(23 * 3600_000);
    expect((await joinWith(id)).json().code).toBe('room-locked');
  });
});
