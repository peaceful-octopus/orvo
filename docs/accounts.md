# Accounts and room access

Orvo works without accounts: anyone can start or join a room as a guest. A server can also let people sign in, and
then choose who may start rooms; a room can choose whether guests may join it.

## Settings

| Where | Setting | Meaning |
| --- | --- | --- |
| Server | `OIDC_ISSUER`, `OIDC_CLIENT_ID` | An OpenID Connect provider and this app's id at it. Setting both turns sign-in on. |
| Server | `OIDC_CLIENT_SECRET` | For providers that require a secret even with PKCE, such as Google. It is published to every client (see "Signing in with Google"). Optional. |
| Server | `OIDC_DESKTOP_CLIENT_ID`, `OIDC_DESKTOP_CLIENT_SECRET` | A separate client for the desktop app, for providers that need a different client type for the loopback redirect (Google). Tokens for either client are accepted. Optional. |
| Server | `OIDC_AUDIENCE`, `OIDC_SCOPE` | What tokens must be meant for (default: the client id), and the scopes the app asks for (default `openid profile email`). |
| Server | `ROOM_CREATION=anyone\|signed-in` | Who may start a room. With `signed-in`, a guest cannot start one, either from the start button or by joining a name nobody has used. Default `anyone`. |
| Server | `DEFAULT_ROOM_ACCESS=anyone\|signed-in` | Whether new rooms admit guests unless their creator says otherwise. Default `anyone`. |
| Room | "Only signed-in people can join" | Chosen when the room is made (by anyone, guests included: it only restricts). After that, only the signed-in person who made the room can change it, with the lock button in the call bar. |

`ROOM_CREATION=signed-in` and `DEFAULT_ROOM_ACCESS=signed-in` refuse to start unless a provider is configured, because
nobody could then sign in.

## How it works

- **The provider does the signing in.** Orvo never sees a password and sends no email. The app uses the
  authorization-code flow with PKCE, and sends a client secret only when the server is configured with one. It sends the provider's **ID token** to the server
  as a bearer token on `POST /v1/rooms`, `POST /v1/rooms/join` and `PATCH /v1/rooms/:room`.
- **The server checks every token** against the provider's published keys (found through discovery): signature,
  expiry, issuer and audience (`apps/beacon/src/auth.ts`, using the `jose` library). A token it does not accept gets
  `invalid-token`, and the app signs the person out and asks them to sign in again.
- **The app learns what to do from the signed config.** `auth: { issuer, clientId, clientSecret?, desktop?, scope, createRequiresLogin }` is
  published only when a provider is set. With none, no sign-in appears anywhere.
- **Errors say what to do.** `login-required-to-create`, `login-required-to-join` and `invalid-token` each have a
  message with a Sign in button.
- **Identity** is `<issuer>|<subject>`, so two providers never collide. It is used for room ownership and, through
  `planFor` in `createBeaconApp`, for looking up a plan (and so TURN access) from the account instead of from an
  entitlement token. The older `entitlement` token path still works.
- **Names.** A signed-in person's account name is the starting point for their display name, which they can still change.
  Other participants are not told who is signed in.

## Owner controls: removing people and locking the room

The signed-in person who made a room sees a **Room controls** button in the call bar, and a remove button on everyone
else's bubble.

- **Remove someone.** They are told, disconnected at once and dropped from everyone else's call. They cannot rejoin
  under the same peer id, and a signed-in person cannot rejoin with the same account even after signing in again. A
  guest has no account to recognise, so a removed guest who reloads the page is a new person unless the room is locked.
  The remove dialog therefore offers **Remove and lock the room** in one step.
- **Lock the room.** A locked room admits only people who were already in it, and its owner. Everyone else, signed in
  or not, is told the room is locked. This is what stops someone typing names at random to find open rooms.
  - "Already in it" means holding a resume token for the room, which every join hands out. It lasts six hours and is
    renewed on every connect, so a member whose connection drops (or who closes the app and reopens it within hours)
    gets back in, and a stranger does not.
  - The owner is always let in, even with no resume token.
  - Unlocking opens the room again. Locking and "only signed-in people" can be used together.
- **How it is enforced.** The lock is checked by the beacon, which every joiner passes through. Removing is done by the
  signaling node that holds the room: the join token the beacon signs says who owns the room and which account each
  joiner is, and the node accepts a `kick` message only from the connection that joined with the owner's token.
- **Limits.** Removed people are remembered by the node while the room is in use there, and forgotten when it empties
  or the node restarts. Only the owner can do any of this, so a guest-made room (which has no owner) has no controls.
  The floating window has no owner controls; dock it to use them.

## Rooms are ephemeral

A room's owner and "signed-in only" rule are kept while the room is in use plus one idle day (refreshed by every join or
reconnect). After that the name is free: anyone can start it again, under the server's rules for starting rooms. So:

- Generated room names (`quiet-pond-reed-abc12345`) cannot be guessed, but a typed name such as `movie-night` can be
  taken over once it has been quiet for a day.
- A room that stays in use for more than a day with nobody joining or reconnecting would lose its rule. Making rooms
  durable, tied to an account, needs a database and is not built.

## Setting up a provider

Register Orvo as a public client (no secret) with the authorization-code flow and PKCE, and allow these redirect URIs:

- **Web:** `https://<your server>/auth/callback`.
- **Desktop app:** `http://127.0.0.1:*/callback`. The desktop app signs in through the system browser and listens on a
  random free port on the same machine for the answer, as RFC 8252 describes. Providers that do not allow any port for
  loopback addresses cannot be used from the desktop app.

Then run the server with the provider's address and the client id:

```
OIDC_ISSUER=https://id.example.com/realms/chill OIDC_CLIENT_ID=orvo ROOM_CREATION=signed-in pnpm --filter @orvo/server start
```

Keycloak, Authentik, Auth0, Okta, Google and any other OpenID Connect provider that publishes
`/.well-known/openid-configuration` and issues ID tokens can be used.

## Signing in with Google

Google's token endpoint requires a client secret even with PKCE, so Orvo can send one. The secret is published to every
client in the signed config, so it is not secret. Google documents this for apps that cannot keep one: the secret
identifies the app. A copied one lets someone pose as Orvo to Google (and use its quota), but a sign-in still needs the
person's consent, and the browser client only accepts the redirect URIs registered on it. Do not reuse a client whose secret protects anything else.

Google needs two client types, because its web clients cannot register the desktop app's random loopback port:

1. In Google Cloud Console, open **APIs & Services → OAuth consent screen** (external, and add test users while it is in
   Testing).
2. **Web application** client, for the browser: authorized redirect URI `https://<your server>/auth/callback`
   (`http://localhost:5173/auth/callback` for development).
3. **Desktop app** client, for the desktop app. It needs no redirect URIs: Google accepts any loopback port.
4. Run the server with both:
   ```
   OIDC_ISSUER=https://accounts.google.com
   OIDC_CLIENT_ID=<web client id>
   OIDC_CLIENT_SECRET=<web client secret>
   OIDC_DESKTOP_CLIENT_ID=<desktop client id>
   OIDC_DESKTOP_CLIENT_SECRET=<desktop client secret>
   ```
   Skip the desktop pair to offer Google sign-in in the browser only.

For Google, the app also asks for a refresh token (`access_type=offline`, with the consent screen) so a session lasts
beyond the hour an ID token lives. Without one the person would have to sign in again every hour.

## Testing sign-in with Google through Keycloak

`deploy/dev-idp` runs a local Keycloak that Orvo uses as a public client, with Google configured inside Keycloak as the
way people log in. Use it to try the flow without publishing a secret, or when you want Keycloak's accounts in front of
Google.

1. In Google Cloud Console, open **APIs & Services → OAuth consent screen**: user type External, status Testing, and add
   your Google account as a test user.
2. Open **Credentials → Create credentials → OAuth client ID → Web application** and add this authorized redirect URI:
   `http://localhost:8081/realms/orvo/broker/google/endpoint`.
3. Copy `deploy/dev-idp/.env.example` to `deploy/dev-idp/.env` and fill in the client id and secret.
4. Start Keycloak: `docker compose -f deploy/dev-idp/compose.yaml up`. The realm `orvo` and its public client `orvo`
   are imported on first start. Its admin console is `http://localhost:8081` (`admin` / `admin`).
5. Start the server against it, and the app with `pnpm dev`:
   ```
   OIDC_ISSUER=http://localhost:8081/realms/orvo OIDC_CLIENT_ID=orvo ROOM_CREATION=signed-in pnpm --filter @orvo/server start
   ```

Sign in from `http://localhost:5173`; Keycloak's login page offers "Google". The first login creates the Keycloak user.
The realm registers `http://127.0.0.1/callback` for the desktop app; Keycloak ignores the port when matching a loopback redirect (RFC 8252), so the random port the app picks is accepted. The client also lists the desktop app's own origins (`http://tauri.localhost`, `tauri://localhost`) as web origins: the app calls the token endpoint from its webview, and Keycloak only sends the CORS header the browser needs for origins on that list. The realm is imported only when it
does not exist, so after editing `realm.json` run `docker compose -f deploy/dev-idp/compose.yaml down -v` first.

## Where tokens live

The tokens are kept in the app's local storage (`orvo:auth`), like the rest of its settings, and renewed with the
refresh token shortly before the ID token runs out. Signing out removes them from the app; it does not sign the person
out of the provider.

## Testing

- `pnpm test:signaling`: removing people (who may, who is kept out, what is remembered).
- `pnpm test:beacon`: the token checks (against a fake provider, `packages/testkit/src/fake-idp.ts`) and every rule above.
- `pnpm test:e2e:accounts`: browsers against a server that needs an account and the fake provider.
- The fake provider approves every sign-in at once. It is for tests only.
