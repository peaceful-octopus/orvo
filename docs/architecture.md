# Architecture

Status: contracts (H0) are implemented in `packages/protocol`. The beacon, new signaling node and raw-WebRTC transport (H1 to H4) are planned; today's app still uses the PeerJS mesh transport.

## Components
- **Client** (`apps/app`, Tauri shell in `apps/desktop`): fetches signed config, asks the beacon where to join, connects to a signaling node, then talks to peers over WebRTC.
- **Beacon** (planned, `apps/beacon`): stateless HTTP service. Serves signed config, creates rooms, places rooms on signaling nodes, issues join tokens and ICE servers, collects telemetry.
- **Signaling node** (planned, `apps/signaling`): owns whole rooms. Verifies join tokens, enforces the room cap, relays opaque SDP/ICE messages. Holds no media.
- **Registry** (Redis): live nodes (`node:{id}`, 15 s TTL) and room leases (`room:{id}`, 60 s TTL).
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

## Test suites
Unit tests are one vitest project per package (`pnpm test` runs only tests related to uncommitted changes; `pnpm test:<package>` runs one package; `pnpm test:all` runs everything). Playwright projects: `smoke` and `layout` run by default (`pnpm test:e2e`, about 20 s), `scale` is opt-in (`pnpm test:e2e:scale`). E2E runs mute browser audio.
