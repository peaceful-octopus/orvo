# Architecture

Status: contracts (`packages/protocol`), the signaling node (`apps/signaling`), a first beacon with in-memory placement (`apps/beacon`), the all-in-one server (`apps/server`) and the raw-WebRTC mesh transport (`packages/rtc`) are implemented. Redis placement (`packages/placement`), node-refreshed leases, tier-based TURN credentials, the signed-config client and `tools/sign-config` are implemented (H2). The app applies the signed config (H3): room size and warning thresholds, video tiers, an "update required" screen when the build is older than `minClientVersion` or `minProtocol`, and dismissible announcements. Telemetry, STUN self-hosting and relay-aware quality (H4, done), observability, load tests and runbooks (H5) are implemented: see `docs/runbook.md` and `docs/capacity.md`. See `docs/self-hosting.md` for running it.

## Components
- **Client** (`apps/app`, Tauri shell in `apps/desktop`): fetches signed config, asks the beacon where to join, connects to a signaling node, then talks to peers over WebRTC.
- **Beacon** (`apps/beacon`): stateless HTTP service. Serves signed config, creates rooms, places rooms on signaling nodes, issues join tokens and ICE servers, collects telemetry.
- **Signaling node** (`apps/signaling`): owns whole rooms. Verifies join tokens, enforces the room cap, relays opaque SDP/ICE messages. Holds no media.
- **Placement store** (`packages/placement`, `PlacementStore` interface): live nodes (6 s TTL, 2 s heartbeat), room leases (60 s TTL, renewed by the owning node) and room tiers. `MemoryPlacementStore` for one process, `RedisPlacementStore` for a fleet; both pass the same contract tests.
- **STUN/TURN** (coturn): STUN for everyone; TURN credentials only for entitled rooms.

## Flow
1. Client loads config (CDN, signed). Verifies the signature against embedded public keys, refuses rollbacks, honors an expired config only within a grace period.
2. `POST /v1/rooms/join` returns `{signalingUrl, joinToken, iceServers, transport, tier}`.
3. Client opens a WebSocket to `signalingUrl` and sends `join {token, name}`.
4. Node replies `welcome {peerId, peers, status}`; peers exchange `signal` messages to set up one `RTCPeerConnection` per pair.
5. Media and data flow directly between peers (or through TURN for entitled rooms).

## Contracts (all in `packages/protocol`)
| Contract | File | Notes |
|---|---|---|
| Signaling frames | `src/signaling.ts` | JSON, `v:1`, 16 KB max, zod-validated; error codes `room-full`, `bad-token`, `not-owner`, `draining`, `upgrade-required`, `rate-limited`, `bad-request` |
| Data-channel messages | `src/datachannel.ts` | `{v, kind, ...}`; unknown kinds and newer versions are ignored |
| Join token | `src/token.ts` | `base64url({kid, payload}).signature`; payload `{room, nodeId, peerId, exp, nonce}`; `NonceCache` blocks replay |
| Client config | `src/config.ts` | Signed envelope `{kid, payload, sig}`; verification returns `malformed`, `unknown-kid`, `bad-signature`, `rollback` or `expired` |
| Signing | `src/signing.ts` | Ed25519 via `@noble/curves`, canonical JSON, key rings by `kid` so keys rotate without an app patch |
| Versions | `src/version.ts` | `PROTOCOL_VERSION`, `compareVersions`, `isClientSupported` for the minimum-version gate |

## Entitlements and TURN
The join request may carry an `entitlement` token. A pluggable `EntitlementVerifier` (none by default, so every room is `free`) decides what it grants. A granted tier sticks to the room for an hour (refreshed on each join), so everyone in an entitled room receives credentials. `relay-lite` and `full` map to separate TURN pools; credentials are coturn REST-style (`<expiry>:<peerId>` plus HMAC-SHA1) and expire on their own.

## Accounts

Optional OpenID Connect sign-in, a server rule for who may start rooms, and per-room "signed-in only" access with an owner. See [accounts.md](accounts.md). Room records (owner, access rule) live in the placement store beside leases and tiers, with a one-day idle expiry.

## Client config
The beacon publishes `limits` (room size, warning size, video tiers), `minClientVersion`, `minProtocol` and an optional `announcement` through environment variables (`MAX_ROOM_SIZE`, `WARN_ROOM_SIZE`, `MIN_CLIENT_VERSION`, `ANNOUNCEMENT`, `ANNOUNCEMENT_ID`) or a pre-signed config file. It also puts the room cap into each join token, so signaling nodes enforce the limit clients were told (a node's own `hardMaxRoomSize`, 100 by default, is a ceiling no token can exceed).

`ConfigClient` (`packages/rtc`) loads `/v1/config`, verifies the signature (against keys embedded at build time via `VITE_TRUSTED_KEYS`, or else the keys the beacon serves over HTTPS), refuses rollbacks, caches the last good config, and tries the beacons it lists in order. The mesh transport fails over across those beacons. Unreachable everywhere: cached config, then built-in defaults.

## Routes and relays
Each peer connection reports whether it runs `direct` or through a `relay`, read from the selected candidate pair (`packages/rtc/src/route.ts`, re-checked every 10 s). `sendPolicy` then lowers video on relayed paths, and sends none over the capped pool of a `relay-lite` room, telling that peer our camera appears off. A connection that never establishes becomes `unreachable` (after ICE restarts or a 25 s timeout) and the room shows who could not be reached. `deploy/turn/` holds the coturn pools; a test checks that they deny private ranges and stay credentialed.

## Reactions and GIFs
Effects are drawn into the sender's own video, so everyone sees them with no extra messages and no change to the signaling or data-channel protocols. While nothing is showing, the plain camera track is sent. When someone reacts or picks a GIF, `EffectsController` (`packages/effects`) starts a `Compositor`: the camera is drawn onto a canvas with emoji particles and the GIF on top, the canvas becomes the outgoing video track (the camera's audio is untouched), and `replaceTrack` swaps it in on every connection without renegotiation. A few hundred milliseconds after the last effect ends the camera track is swapped back and the canvas is released. A worker drives the drawing so it is not throttled when the window is in the background. GIFs are played from Giphy's MP4 renditions (small, with CORS headers, so the canvas stays untainted). Reactions need the camera on, since the other side hides the video of a camera that is off.

The GIF picker uses the Giphy Web SDK (`@giphy/react-components`), loaded on demand. The key comes from the beacon's signed config (`integrations.giphyApiKey`, set with `GIPHY_API_KEY`), so it can be rotated or removed from the server without shipping a new app. Release builds never contain a key; `VITE_GIPHY_API_KEY` in `apps/app/.env.local` is read only by the development server. Without a key the GIF button is hidden. Searches go from the user's browser to Giphy. Results are limited to PG, and the picker shows "Powered by GIPHY".

## Observability
Every service exposes Prometheus metrics (`prom-client` through `packages/metrics`): nodes report connections, rooms, members, joins and refusals by reason, signals relayed and dropped; the beacon reports joins by outcome and tier, join latency, nodes seen, draining nodes and whether placement is degraded. Clients send anonymous statistics (`POST /v1/telemetry`: join result and time, how each peer connection settled and whether it was direct or relayed, signaling reconnects) which the beacon folds into metrics and does not store; users can turn this off. `deploy/observability/` holds the Prometheus rules, a Grafana dashboard and a compose file, and a test fails if an alert or panel names a metric that does not exist or an alert is missing from the runbook.

## Failure behavior
A beacon wraps its Redis store in `ResilientPlacementStore`: if Redis is unreachable it keeps routing existing rooms to their nodes and places new rooms on the last known nodes from memory. A draining node refuses only new rooms; people joining or returning to rooms it hosts are still admitted. Signing keys rotate without downtime (`PREVIOUS_PUBLIC_KEYS` on beacons; nodes learn new keys from the beacon every five minutes). These behaviors are covered by `tools/loadgen/src/chaos.int.test.ts`.

## Room placement
Rendezvous hashing over live nodes picks a room's owner; the first resolve writes a lease so later resolves agree even if the node set changes. A room lives wholly on one node, so the room cap is a local counter and nodes never talk to each other.

## Tiers
`free` rooms receive STUN only. Entitled rooms also receive time-limited TURN credentials (coturn REST auth). Credentials are issued only by the beacon, so TURN is unreachable without entitlement.

## Deployment profiles
1. **Personal**: `apps/server` runs web app, beacon and signaling in one process (`docker run -p 8080:8080`); the TLS origin is the trust anchor, so the signing key is generated and stored in `DATA_DIR`.
2. **Small team**: beacon and signaling nodes as separate containers.
3. **Platform scale**: many nodes, shared store, CDN-served signed config.

## Reconnecting
A signaling drop does not end calls: media flows peer to peer. The node keeps a dropped member's slot for a grace period (default 10 s) and the client rejoins through the beacon with jittered backoff using a resume token, keeping its peer id. If the node did not recognize the client (`welcome.resumed` false, for example after a server restart), the client rebuilds every connection.

## Test suites
Unit tests are one vitest project per package (`pnpm test` runs only tests related to uncommitted changes; `pnpm test:<package>` runs one package; `pnpm test:all` runs everything). Playwright projects: `smoke` and `layout` run by default (`pnpm test:e2e`, about 20 s); `resilience` (`pnpm test:e2e:resilience`, drops the signaling socket mid-call) and `scale` (10 peers, about 45 s) are opt-in. Set `E2E_BASE_URL` to run against an already running server. E2E runs mute browser audio.
