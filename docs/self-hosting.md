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

Configuration (environment variables): `PORT` (8080), `DATA_DIR` (`/data`), `STUN_URLS` (comma separated), `CORS_ORIGIN` (any), `BEHIND_PROXY`, `DRAIN_MS` (5000, delay before shutdown so clients can finish).

Without Docker: `pnpm install`, `pnpm --filter @chillcall/app build`, `pnpm --filter @chillcall/server start`.

## 2. Small team: separate beacon and signaling
Run `apps/beacon` (`NODES` lists the signaling nodes) and one or more `apps/signaling` nodes (`TRUSTED_KEYS` holds the beacon's public key from `GET /v1/keys`). Placement and leases are in memory per beacon in this release, so run a single beacon; a Redis store for several beacons is planned.

## 3. Platform scale
Many signaling nodes behind the beacon fleet with a shared Redis, signed config on a CDN, regional TURN. See `docs/architecture.md`; not implemented yet beyond the placement interfaces.

## Using the desktop app with your server
Open the app, expand **Server** on the home screen and enter your server address (`https://chill.example.com`). Leave it empty to use the default.
