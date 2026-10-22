# Self-hosting

Three profiles use the same code. Start with the first.

## 1. Personal: one container
Web app, beacon API and signaling node run in one process. No Redis, no Kubernetes.

```
cd deploy/personal
docker compose up -d          # http://localhost:8080
```

State lives in the `chillcall-data` volume: a generated signing key (`keys.json`) so restarts keep tokens and cached config valid. Delete it to rotate the key.

**Friends over the internet need HTTPS.** Browsers only allow camera access on `localhost` or over HTTPS. Either put your own reverse proxy in front (it must pass WebSocket upgrades on `/ws`, and set `BEHIND_PROXY=1` so the server builds `wss://` URLs), or use the bundled Caddy:

```
DOMAIN=chill.example.com BEHIND_PROXY=1 docker compose --profile https up -d
```

**STUN.** By default clients use Google's public STUN server. To run your own (almost no bandwidth), `docker compose --profile stun up -d`, open UDP 3478, and set `STUN_URLS=stun:your-host:3478`.

**No TURN relay.** Two people who are both behind restrictive networks (some corporate or mobile connections) may not be able to connect directly; the app shows "(can't connect)" for that person. A relay is optional and not set up by default.

**Stopping gracefully.** On `SIGTERM` the server stops taking new rooms and keeps serving for `DRAIN_MS` before exiting, so give it longer than that to stop: the compose files set `stop_grace_period`, and with `docker run` use `--stop-timeout 15` (Kubernetes: `terminationGracePeriodSeconds`). Some Docker installs default to a one-second stop timeout, which would cut the drain short and kill the process.

Configuration (environment variables): `PORT` (8080), `DATA_DIR` (`/data`), `STUN_URLS` (comma separated), `CORS_ORIGIN` (any), `BEHIND_PROXY`, `DRAIN_MS` (5000, delay before shutdown so clients can finish), `MAX_ROOM_SIZE` / `WARN_ROOM_SIZE` (10 / 6), `MIN_CLIENT_VERSION` (refuse older apps), `ANNOUNCEMENT` and `ANNOUNCEMENT_ID` (a dismissible notice shown to everyone; change the id to show a new one).

Without Docker: `pnpm install`, `pnpm --filter @chillcall/app build`, `pnpm --filter @chillcall/server start`.

## 2. Small team: beacon, signaling nodes and Redis
`deploy/team/compose.yaml` runs a beacon, two signaling nodes, Redis and Caddy from the same image. Nodes register themselves in Redis and keep their rooms' leases alive; the beacon places each room on one node and every participant of that room is sent to it.

```
cd tools/sign-config && pnpm exec tsx src/main.ts keygen --kid prod-1    # prints the signing key pair
cd ../../deploy/team
export SIGNING_KEY=prod-1:<secretKey>     # shared by every beacon; nodes fetch the public key from the beacon
export DOMAIN=chill.example.com           # DNS for chill.example.com, n1.chill.example.com, n2.chill.example.com
docker compose up -d
```

To add capacity, add another `node-N` service with its own `NODE_ID` and `PUBLIC_WS_URL` and a Caddy entry; nothing else changes. To retire a node, send it `SIGTERM`: it stops receiving new rooms, waits `DRAIN_MS` for calls to finish, then disconnects clients, who rejoin through the beacon.

Optional relay (TURN) for entitled rooms only: set `TURN_URLS` and `TURN_SECRET` on the beacon (coturn with `use-auth-secret`, `denied-peer-ip` for private ranges). Without them every room gets STUN only. Ordinary rooms never receive relay credentials; a future entitlement service grants them per room.

Beacon environment: `REDIS_URL`, `SIGNING_KEY`, `STUN_URLS`, `TURN_URLS`, `TURN_SECRET`, `TURN_LITE_URLS`, `TURN_LITE_SECRET` (capped pool), `MAX_ROOM_SIZE`, `WARN_ROOM_SIZE`, `MIN_CLIENT_VERSION`, `ANNOUNCEMENT`, `ANNOUNCEMENT_ID`, `CONFIG_FILE` (a pre-signed config served as is), `WEB_DIR`, `CORS_ORIGIN`, `BEHIND_PROXY`. Node environment: `BEACON_URL` or `TRUSTED_KEYS`, `REDIS_URL`, `PUBLIC_WS_URL`, `NODE_ID`, `REGION`, `WEIGHT`, `DRAIN_MS`.

### STUN and relay (TURN)
- **STUN** lets two browsers find a direct path to each other and costs almost no bandwidth. Everyone gets it. The default is Google's public server; to use your own, run `docker compose --profile stun up -d` (both compose files have the profile) and set `STUN_URLS=stun:stun.your-domain:3478`.
- **A relay (TURN)** carries the media itself for people whose networks block direct connections, so it costs real bandwidth. Rooms get one only with an entitlement; everyone else gets STUN only and the app tells them who it could not connect to. To run relays, use `deploy/turn/compose.yaml`: a `full` pool (uncapped) and a `relay-lite` pool (capped at about 64 kbit/s, so audio only). Put the same secrets and URLs into the beacon (`TURN_URLS`, `TURN_SECRET`, `TURN_LITE_URLS`, `TURN_LITE_SECRET`). The configs refuse to relay to private and loopback addresses; a test guards that, so keep those lines if you edit them.
- **How the app behaves on a relay:** it detects relayed connections and lowers video quality on them (`limits.relayVideoTier` in the config, 200 kbit/s by default). In a `relay-lite` room it sends no video over the relay at all and the other person sees the camera as off.
- **Checking a room:** open a room URL with `?ice=relay` to force relay-only connections. In a room without a relay, that person is shown as unreachable; in an entitled room it connects.

### Verified setups
The personal image, the personal compose file (with and without the HTTPS profile), the small-team stack with a real Redis (with and without Caddy), the relay pools, the STUN profile and the monitoring stack were each run in Docker and exercised with the browser tests and a simulated-user crash drill. The relay pools and the `stun` profile use host networking, which needs a Linux host (Docker Desktop on Windows or macOS does not support it without extra settings); their configs were verified in ordinary containers instead.

## 3. Platform scale
Many signaling nodes behind the beacon fleet with a shared Redis, signed config on a CDN, regional TURN. Everything in profile 2 scales horizontally: more nodes, several beacons sharing one Redis and one `SIGNING_KEY`. For a CDN-hosted config, sign it with `tools/sign-config` (`sign config.json --key <kid>:<secret> --out signed.json`), upload it, point `CONFIG_FILE` at it or serve it directly, and build the app with `VITE_TRUSTED_KEYS='{"<kid>":"<publicKey>"}'` so clients pin the key. Still planned: multi-region pools and Redis clustering; see `docs/architecture.md`.

## Using the desktop app with your server
Open the app, expand **Server** on the home screen and enter your server address (`https://chill.example.com`). Leave it empty to use the default.
