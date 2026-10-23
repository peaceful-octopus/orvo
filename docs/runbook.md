# Runbook

For operators of an Orvo deployment (the small-team or platform profiles in `docs/self-hosting.md`). A personal single container needs none of this beyond `docker compose logs`.

## What you are running
- **Beacon** (stateless, run several): answers `join` requests, signs tokens and config, keeps room-to-node placement.
- **Signaling nodes**: each owns whole rooms and relays offers, answers and candidates. They hold no media. Calls that are already connected keep working if signaling disappears.
- **Redis**: node registrations (6 s TTL, refreshed every 2 s) and room leases (60 s TTL, renewed by the owning node). Optional for one beacon.
- **STUN/TURN**: STUN for everyone; relays only for entitled rooms.

Dashboards: `deploy/observability/` has Prometheus rules, a Grafana dashboard and a compose file. Every service exposes `/metrics`; nodes also have `/healthz` and `/readyz` (503 while draining).

## Routine operations

### Deploy a new version (rolling)
1. Beacons first, one at a time: they are stateless. Clients retry and fail over between beacon addresses.
2. Then nodes, one at a time. Send `SIGTERM`: the node stops accepting new rooms, keeps serving its rooms for `DRAIN_MS` (30 s by default), then disconnects clients. Whatever stops the container must wait longer than `DRAIN_MS` (compose `stop_grace_period`, Docker `--stop-timeout`, Kubernetes `terminationGracePeriodSeconds`); Docker installs that default to a one-second stop timeout kill the node mid-drain and everyone reconnects at once. They reconnect through the beacon with a short random delay and keep their identity, so a call sees a brief signaling gap and no media interruption between peers who stay connected.
3. Wait until the node count and connection graph recover before the next one. Raise `DRAIN_MS` if you want people to finish calls first; rooms that are still occupied when it ends are moved.

### Add capacity
Start another node with its own `NODE_ID` and `PUBLIC_WS_URL`. It registers itself within seconds and receives only *new* rooms; running rooms stay where they are. Nothing else changes.

### Retire a node
`SIGTERM` as above, wait for it to exit, then remove it. If it is stuck, `docker kill` is safe: its registration expires and its rooms move (see "A node crashes").

### Publish a notice, a minimum version or new limits
Set `ANNOUNCEMENT` and `ANNOUNCEMENT_ID` (a new id shows the notice again to people who dismissed the last one), `MIN_CLIENT_VERSION`, `MAX_ROOM_SIZE` or `WARN_ROOM_SIZE` on the beacons and restart them one at a time. Clients pick up the signed config on their next start or reconnect. Raising `MIN_CLIENT_VERSION` blocks older apps behind an "update required" screen, so announce it first.

### Move a server without an app update
Clients keep a list of beacon addresses from the signed config. Add the new address to `beaconUrls` (use `tools/sign-config` for a CDN-hosted config), let clients fetch it, then retire the old address. Keep the old one answering until most clients have updated their cached config.

### Rotate the signing key
1. Generate a new key: `tools/sign-config keygen --kid <new-id>`.
2. On every beacon, set `SIGNING_KEY=<new-id>:<secret>` and `PREVIOUS_PUBLIC_KEYS='{"<old-id>":"<old public key>"}'`. `GET /v1/keys` now publishes both.
3. Signaling nodes fetching keys from `BEACON_URL` learn the new key within five minutes without a restart. Nodes with a fixed `TRUSTED_KEYS` need it updated first, **before** step 2.
4. Apps without embedded keys re-fetch keys from the beacon when a signature fails. Apps built with `VITE_TRUSTED_KEYS` need a release that embeds the new public key; ship that **before** step 2 and wait for it to spread.
5. After the longest-lived tokens have expired (resume tokens last 15 minutes) and cached configs have been refreshed, remove `PREVIOUS_PUBLIC_KEYS` and restart the nodes once to drop the old key.

## Alerts
Each heading is an alert name from `deploy/observability/alerts.yml`.

### BeaconDown
A beacon instance is not answering scrapes. Clients fail over to other beacon addresses, so one instance down is degraded, not an outage; all down means nobody can join or reconnect (connected calls continue). Check the process and its logs; check the load balancer health. A stuck process is safe to kill.

### SignalingNodeDown
A node stopped answering scrapes. If it crashed, its rooms move once its registration expires (up to 6 s), then clients reconnect on their own. Check why it died (`docker logs`, out of memory is the usual cause: see `SignalingMemoryHigh`). Restart it; it will receive new rooms again.

### NoSignalingNodes
The beacon lists no live nodes, so every join gets a 503. Either all nodes are down, or they cannot reach Redis to register (`docker logs node-1`, look for "placement store error"), or `REDIS_URL` differs between beacon and nodes. Fix Redis connectivity first; nodes re-register on their next heartbeat (5 s).

### JoinFailuresHigh
More than 5% of joins end in `no-nodes` or `error`. `no-nodes` points at the same causes as `NoSignalingNodes`; `error` at beacon bugs or a broken dependency (check beacon logs). Joins refused for other reasons (bad request, update required) are not counted here.

### JoinLatencyHigh
The 99th percentile of beacon join time is over a second. The beacon makes a few store lookups and signs two tokens per join, so look at Redis latency and beacon CPU. If Redis is slow, the beacon's resilient store will fall back to memory only on errors, not on slowness: restart or fail over Redis.

### SignalingEventLoopLagging
A node's event loop is delayed more than 200 ms. The node is CPU-bound (one thread). Check `orvo_signaling_connections` for that node, and recent growth in `orvo_signaling_signals_relayed_total`. Add nodes: new rooms spread over them. Do not restart a loaded node as a first resort: everyone it hosts reconnects at once.

### SignalingConnectionsHigh
A node holds over 8,000 connections. Measured capacity is in `docs/capacity.md`; 8,000 is a planning threshold well below where a node degrades. Add nodes before it matters. New rooms go to the least loaded by hashing; existing rooms do not move, so a skewed node drains only as rooms end.

### SignalingMemoryHigh
A node uses over 1.5 GB. Measured memory per connection is in `docs/capacity.md`; usage far above that for the current connection count suggests a leak or a flood of connections. Compare connections to memory on the dashboard. Drain and restart the node (`SIGTERM`); capture a heap snapshot first if it recurs.

### SignalingRateLimiting
Clients are being disconnected for sending signals too fast. One abusive client is closed and may reconnect and repeat; many suggests a buggy client version. Check `orvo_beacon_joins_by_client_version_total` on the beacon to see which client versions are joining, and consider `MIN_CLIENT_VERSION`.

### PlacementStoreDegraded
A beacon cannot reach Redis and is placing rooms from memory. Running calls are unaffected, rooms stay on their nodes, and new joins still succeed. Risk: two beacons may place the *same new room* on different nodes until Redis returns, splitting that room. Restore Redis; the beacon recovers by itself. Rooms split during the outage correct themselves when members next reconnect.

### DirectConnectionRateLow
Under 80% of connected pairs are direct. Free rooms have no relay, so the remainder either need a relay (entitled rooms) or fail (see `PeersUnreachableHigh`). A drop usually means a large group of users on restrictive networks (a company or school adopting the app). It is a signal for sizing relay capacity, not an incident.

### PeersUnreachableHigh
More than 15% of peer connections fail to establish. Those users see "can't connect" for other people. Causes: restrictive networks without a relay, or an unreachable STUN server (check `STUN_URLS` from outside your network). If your STUN server is down, clients fall back to host candidates only and fail across networks.

### SignalingReconnectStorm
Many clients are reconnecting at once, typically after a node failure or network event. Reconnects are jittered, so a storm of thousands spreads over about 30 seconds. Check for a failed node or a broken load balancer; this alert resolves by itself once the cause does. Watch beacon CPU and Redis during the storm.

## Failure scenarios and what to expect
These are exercised by `pnpm exec vitest run --project "int:loadgen"` (`tools/loadgen/src/chaos.int.test.ts`).

### A node shuts down cleanly
Its rooms move to other nodes. Clients reconnect within seconds (the drill asserts under 10 s for every client), keep their identities, and see no joins fail.

### A node crashes
Nothing deregisters it, so for up to the registration TTL (6 s) the beacon may still hand out its address and clients fail to connect. They retry with delays capped at 4 s (an unreachable beacon backs off up to 30 s instead), so once the registration lapses the next attempt succeeds elsewhere and rooms are consistently on one surviving node. Each client makes exactly one reconnect loop, however many attempts fail. A longer TTL tolerates a Redis blip without nodes dropping out; a shorter one recovers faster.

### Redis is unreachable
Connected calls are untouched. Beacons answer from memory (`PlacementStoreDegraded` fires): existing rooms still resolve to their nodes and new rooms can still be created. Nodes log store errors and keep serving. When Redis returns, leases are renewed and rooms have not moved.

### The beacon is unreachable
Connected calls are untouched. A client whose signaling connection drops cannot rejoin until a beacon answers, and keeps retrying with growing, jittered delays; when a beacon returns it rejoins with the same identity.

### The CDN or config host is unreachable
Clients use their cached signed config (valid up to a week past its expiry, never older than the newest config they have seen) and then built-in defaults. New installs without any cached config use defaults and the beacon address baked into the build.

## Load testing
`pnpm load:fleet` starts a beacon and three nodes locally and simulates people (default 1,000, 30 s ramp). For a deployment: `pnpm load --target https://orvo.example.com --scrape https://n1.example.com/metrics,https://n2.example.com/metrics --users 10000 --ramp 120 --hold 60`. It simulates signaling only (join, offers, answers, candidates, reconnects), not media. Do it against a staging deployment, and set `RATE_LIMIT_PER_MINUTE=0` on its beacon because every simulated user shares one address. Measured results and how to read them are in `docs/capacity.md`.

### Checking a deployment
`node deploy/observability/check.mjs http://prometheus:9090` verifies that every scrape target is up, every alert rule loaded and evaluates, and every Grafana panel query is valid. `deploy/team/compose.test.yaml` and `deploy/observability/compose.test.yaml` run the small-team and monitoring stacks on one machine (no DNS or HTTPS) so you can rehearse a node crash (`docker kill`) and watch `SignalingNodeDown` fire.
