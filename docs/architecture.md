# Architecture

Status: contracts (`packages/protocol`), the signaling node (`apps/signaling`), a first beacon with in-memory placement (`apps/beacon`), the all-in-one server (`apps/server`) and the raw-WebRTC mesh transport (`packages/rtc`) are implemented. Redis placement, node-refreshed leases, telemetry, TURN credentials and CDN-served config with embedded keys are planned (H2 to H4). See `docs/self-hosting.md` for running it.

## Components
- **Client** (`apps/app`, Tauri shell in `apps/desktop`): fetches signed config, asks the beacon where to join, connects to a signaling node, then talks to peers over WebRTC.
- **Beacon** (`apps/beacon`): stateless HTTP service. Serves signed config, creates rooms, places rooms on signaling nodes, issues join tokens and ICE servers, collects telemetry.
- **Signaling node** (`apps/signaling`): owns whole rooms. Verifies join tokens, enforces the room cap, relays opaque SDP/ICE messages. Holds no media.
- **Placement store** (`PlacementStore` interface): live nodes and room leases (60 s TTL). In memory today (single beacon or all-in-one); a Redis implementation is planned for several beacons.
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
