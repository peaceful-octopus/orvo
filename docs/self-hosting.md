# Self-hosting

Three profiles use the same code. Start with the first.

## 1. Personal: one container
Web app, beacon API and signaling node run in one process. No Redis, no Kubernetes.

```
cd deploy/personal
docker compose up -d          # http://localhost:8080
```

State lives in the `orvo-data` volume: a generated signing key (`keys.json`) so restarts keep tokens and cached config valid. Delete it to rotate the key.

**Friends over the internet need HTTPS.** Browsers only allow camera access on `localhost` or over HTTPS. Put your own reverse proxy in front of port 8080. It must pass WebSocket upgrades on `/ws`, and you set `BEHIND_PROXY=1` so the server builds `wss://` URLs:

```
BEHIND_PROXY=1 docker compose up -d
```

**STUN.** Clients use Google's public STUN server by default. To use another, set `STUN_URLS=stun:your-host:3478`.

**Relay (TURN), for when video never arrives.** If two people join the room and see each other in the list but no video comes through, their networks are blocking a direct connection (common on mobile data and some home or office networks). A relay carries the media for them, which uses your server's bandwidth. On a personal server, setting `TURN_URLS` and `TURN_SECRET` gives every room relay credentials. Run coturn with the `turn` profile on a Linux host with a public address:

```
TURN_SECRET=<long random string> EXTERNAL_HOST=turn.example.com LAN_IP=192.168.1.20 docker compose --profile turn up -d
TURN_URLS=turn:turn.example.com:3478 TURN_SECRET=<the same string> BEHIND_PROXY=1 docker compose up -d
```

The relay has to know its public address. `EXTERNAL_HOST` is a hostname that follows your IP address (a DNS-only record, kept current by your dynamic DNS). The relay looks it up when it starts and every minute after, and restarts itself with the new address when it changes, so calls going through the relay reconnect. If your address never changes, use `EXTERNAL_IP=<public address>` instead. `LAN_IP` is the host's address on your network. Set it when the host is behind a router that does NAT, so two people who are both on the relay can reach each other.

Open UDP and TCP 3478 and UDP 49152-50175 to the internet. The relay is its own service on its own ports, so the reverse proxy does not carry it. Use the same `TURN_SECRET` on both. A relay on another machine works the same way: point `TURN_URLS` at it. The coturn settings are written into the compose file itself, so you can copy `compose.yaml` to your server on its own. They refuse to relay to private and loopback addresses; a test keeps them identical to `deploy/turn/turnserver.full.conf`. To confirm it works, open a room URL with `?ice=relay`, which forces relay-only connections.

**Stopping gracefully.** On `SIGTERM` the server stops taking new rooms and keeps serving for `DRAIN_MS` before exiting, so give it longer than that to stop: the compose files set `stop_grace_period`, and with `docker run` use `--stop-timeout 15` (Kubernetes: `terminationGracePeriodSeconds`). Some Docker installs default to a one-second stop timeout, which would cut the drain short and kill the process.

**Accounts (optional; nothing to do if you don't want them).** The defaults are unchanged: with no sign-in provider configured, everyone is a guest, anyone can start and join rooms, and no sign-in appears in the app. The personal setup stays one container with no database.

If you do want accounts, for example so only you and your family can start rooms, Orvo uses an OpenID Connect provider that you run or already use (Google, Keycloak, Authentik, Auth0 and so on) and stores no passwords. Put the settings in the environment or in a `.env` file next to `compose.yaml`, which compose passes through:

```
OIDC_ISSUER=https://id.example.com/realms/home
OIDC_CLIENT_ID=orvo
ROOM_CREATION=signed-in        # only signed-in people can start rooms; guests can still join open ones
DEFAULT_ROOM_ACCESS=anyone     # or signed-in, to make new rooms signed-in only unless their creator chooses otherwise
```

What to know on a personal server:
- **You need a provider to require sign-in.** `ROOM_CREATION=signed-in` and `DEFAULT_ROOM_ACCESS=signed-in` refuse to start without `OIDC_ISSUER` and `OIDC_CLIENT_ID`. There is no built-in user list or password option.
- **Web sign-in needs HTTPS and a registered redirect.** Register `https://<your domain>/auth/callback` with the provider (behind your reverse proxy). The desktop app needs `http://127.0.0.1:*/callback`.
- **Room owners and rules are kept in memory.** Restarting the container forgets who owns a room and which rooms were signed-in only (everyone is disconnected by a restart anyway). Rooms also forget them after a day of nobody joining.

Details, the exact behavior and provider setup: [accounts.md](accounts.md).

**GIFs.** To offer a GIF picker, create a Web SDK key in the [Giphy developer dashboard](https://developers.giphy.com/) and set `GIPHY_API_KEY`. The server publishes it to clients in its signed config; it is public by design (it ships to every browser), so use a key made for this app and keep an eye on its quota (new keys start with a low hourly limit until Giphy approves a production key). Without the key the GIF button is hidden and emoji reactions still work. The desktop and web apps never contain the key themselves, so installers can be shared freely and the key can be rotated on the server. When developing, `VITE_GIPHY_API_KEY` in `apps/app/.env.local` (which git ignores) works with the development server only, and a release build fails if that key ends up in its output. To use GIFs with a locally built installer, start the server with `GIPHY_API_KEY` set.

Configuration (environment variables): `PORT` (8080), `DATA_DIR` (`/data`), `STUN_URLS` (comma separated), `CORS_ORIGIN` (any), `BEHIND_PROXY`, `GIPHY_API_KEY`, `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_AUDIENCE` / `OIDC_SCOPE`, `ROOM_CREATION` (`anyone` or `signed-in`), `DEFAULT_ROOM_ACCESS` (`anyone` or `signed-in`), `DRAIN_MS` (5000, delay before shutdown so clients can finish), `MAX_ROOM_SIZE` / `WARN_ROOM_SIZE` (10 / 6), `MIN_CLIENT_VERSION` (refuse older apps), `ANNOUNCEMENT` and `ANNOUNCEMENT_ID` (a dismissible notice shown to everyone; change the id to show a new one).

Without Docker: `pnpm install`, `pnpm --filter @orvo/app build`, `pnpm --filter @orvo/server start`.

## 2. Small team: beacon, signaling nodes and Redis
`deploy/team/compose.yaml` runs a beacon, two signaling nodes, Redis and Caddy from the same image. Nodes register themselves in Redis and keep their rooms' leases alive; the beacon places each room on one node and every participant of that room is sent to it.

```
cd tools/sign-config && pnpm exec tsx src/main.ts keygen --kid prod-1    # prints the signing key pair
cd ../../deploy/team
export SIGNING_KEY=prod-1:<secretKey>     # shared by every beacon; nodes fetch the public key from the beacon
export DOMAIN=orvo.example.com           # DNS for orvo.example.com, n1.orvo.example.com, n2.orvo.example.com
docker compose up -d
```

To add capacity, add another `node-N` service with its own `NODE_ID` and `PUBLIC_WS_URL` and a Caddy entry; nothing else changes. To retire a node, send it `SIGTERM`: it stops receiving new rooms, waits `DRAIN_MS` for calls to finish, then disconnects clients, who rejoin through the beacon.

Optional relay (TURN) for entitled rooms only: set `TURN_URLS` and `TURN_SECRET` on the beacon (coturn with `use-auth-secret`, `denied-peer-ip` for private ranges). Without them every room gets STUN only. Ordinary rooms never receive relay credentials; a future entitlement service grants them per room.

Beacon environment: `REDIS_URL`, `SIGNING_KEY`, `STUN_URLS`, `TURN_URLS`, `TURN_SECRET`, `TURN_LITE_URLS`, `TURN_LITE_SECRET` (capped pool), `MAX_ROOM_SIZE`, `WARN_ROOM_SIZE`, `RELAY_VIDEO_KBPS`, `RELAY_VIDEO_SCALE`, `RELAY_VIDEO_FPS`, `MIN_CLIENT_VERSION`, `ANNOUNCEMENT`, `ANNOUNCEMENT_ID`, `GIPHY_API_KEY`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE`, `ROOM_CREATION`, `DEFAULT_ROOM_ACCESS` (see [accounts.md](accounts.md); with several beacons and `REDIS_URL`, room owners and rules are shared through Redis), `CONFIG_FILE` (a pre-signed config served as is), `WEB_DIR`, `CORS_ORIGIN`, `BEHIND_PROXY`. Node environment: `BEACON_URL` or `TRUSTED_KEYS`, `REDIS_URL`, `PUBLIC_WS_URL`, `NODE_ID`, `REGION`, `WEIGHT`, `DRAIN_MS`.

### STUN and relay (TURN)
- **STUN** lets two browsers find a direct path to each other and costs almost no bandwidth. Everyone gets it. The default is Google's public server; to use your own, run `docker compose --profile stun up -d` (both compose files have the profile) and set `STUN_URLS=stun:stun.your-domain:3478`.
- **A relay (TURN)** carries the media itself for people whose networks block direct connections, so it costs real bandwidth. Rooms get one only with an entitlement; everyone else gets STUN only and the app tells them who it could not connect to. To run relays, use `deploy/turn/compose.yaml`: a `full` pool (uncapped) and a `relay-lite` pool (capped at about 64 kbit/s, so audio only). Put the same secrets and URLs into the beacon (`TURN_URLS`, `TURN_SECRET`, `TURN_LITE_URLS`, `TURN_LITE_SECRET`). The configs refuse to relay to private and loopback addresses; a test guards that, so keep those lines if you edit them.
- **How the app behaves on a relay:** it detects relayed connections and lowers video quality on them (`limits.relayVideoTier` in the config; 200 kbit/s, half size and 15 frames a second by default). If relayed video looks blocky, raise it with `RELAY_VIDEO_KBPS`, `RELAY_VIDEO_SCALE` (1 is full size, 2 is half in each direction) and `RELAY_VIDEO_FPS` on the server or beacon. `RELAY_VIDEO_KBPS=1000 RELAY_VIDEO_SCALE=1 RELAY_VIDEO_FPS=30` gives roughly the quality of a direct call, and every relayed participant then uses up to that much of your upload bandwidth in each direction. Each setting replaces only its own part of the default. Clients pick the change up when they next load the config, within an hour or on restart. In a `relay-lite` room it sends no video over the relay at all and the other person sees the camera as off.
- **Checking a room:** open a room URL with `?ice=relay` to force relay-only connections. In a room without a relay, that person is shown as unreachable; in an entitled room it connects.

### Verified setups
The personal image, the personal compose file, the small-team stack with a real Redis (with and without Caddy), the relay pools, the STUN profile and the monitoring stack were each run in Docker and exercised with the browser tests and a simulated-user crash drill. The relay pools and the `stun` profile use host networking, which needs a Linux host (Docker Desktop on Windows or macOS does not support it without extra settings); their configs were verified in ordinary containers instead.

## 3. Platform scale
Many signaling nodes behind the beacon fleet with a shared Redis, signed config on a CDN, regional TURN. Everything in profile 2 scales horizontally: more nodes, several beacons sharing one Redis and one `SIGNING_KEY`. For a CDN-hosted config, sign it with `tools/sign-config` (`sign config.json --key <kid>:<secret> --out signed.json`), upload it, point `CONFIG_FILE` at it or serve it directly, and build the app with `VITE_TRUSTED_KEYS='{"<kid>":"<publicKey>"}'` so clients pin the key. Still planned: multi-region pools and Redis clustering; see `docs/architecture.md`.

## Using the desktop app with your server
Open the app, expand **Server** on the home screen and enter your server address (`https://orvo.example.com`). Leave it empty to use the default.
