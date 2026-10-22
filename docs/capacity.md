# Capacity

What the signaling layer was measured to handle, how it was measured, and what was not measured. Media is peer to peer and does not touch these servers; relay (TURN) traffic is a separate matter covered at the end.

## How it was measured
`tools/loadgen` simulates people at the protocol level: each one asks the beacon for a node, joins over WebSocket with a signed token, exchanges the offers, answers and candidates a pair of browsers would (14 signals per pair and direction), reconnects with a resume token if dropped, and leaves. Rooms follow a casual-call mix (40% pairs, mean about 3 people, none above 10). Nodes and the beacon ran as separate processes; the load generator, beacon and all nodes shared one Windows 11 development machine over loopback. Raw reports are in `docs/capacity-results/`.

```
pnpm load:fleet                                   # 1,000 users, local beacon and three nodes
pnpm --filter @chillcall/loadgen start --fleet 3 --users 10000 --ramp 60 --hold 30
pnpm --filter @chillcall/loadgen start --fleet 1 --users 15000 --ramp 90 --hold 30
```

## Results
| Run | Connected | Joins failed | Join time p50 / p99 | Signal round trip p99 | Per node |
|---|---|---|---|---|---|
| 1,000 users, 3 nodes | 1,000 | 0 | 9 ms / 19 ms | 5 ms | about 300 connections, 117 MB, 5% of a core |
| 10,000 users, 3 nodes | 10,000 | 0 | 10 ms / 150 ms | 12 ms | about 3,300 connections, 150 to 216 MB, 17% of a core |
| 15,000 users, 1 node | 13,481 | 1,519 (client ran out of ports) | 14 ms / 624 ms | 187 ms | 13,400 connections, 314 MB, 68% of a core, event-loop lag p99 134 ms |

- **10,000 simultaneous users across three nodes: every join succeeded**, every one of the 460,432 relayed signals was delivered, and no client had to reconnect. The 10,000 joins arrived over 60 seconds, about 170 per second at the peak, and the single beacon process answered them with a 99th-percentile join time of 150 ms.
- **One node held 13,400 connections.** It was not the limit: the 1,519 failures are the load machine exhausting Windows's dynamic port range (49152 to 65535, 16,384 ports shared by every outgoing connection on it; reported as `beacon-unreachable` and `socket-error`). A real deployment has no such limit because users come from many addresses. At that load the node used about two thirds of one core and its event-loop lag p99 was 134 ms, which is approaching the 200 ms alert threshold, so the real ceiling is somewhat above 13,400 and not measured.
- **Memory** settled around 15 to 30 KB per connection above a baseline of roughly 110 MB. Garbage collection makes single readings noisy.

## Planning numbers
The `SignalingConnectionsHigh` alert fires at 8,000 connections per node, about 60% of the measured 13,400, so that a node losing a neighbor can absorb its rooms and a reconnect storm. Plan on that:

| Concurrent users | Rooms (about 3 each) | Signaling nodes at 8,000 (minimum 3 for HA) | Beacon joins per second, average / peak (45-minute sessions, peak 3x) |
|---|---|---|---|
| 10,000 | about 3,300 | 3 (measured at 3,300 each) | 4 / 12 |
| 100,000 | about 33,000 | 13 | 37 / 110 |
| 300,000 | about 100,000 | 38 | 110 / 330 |

Peak join rates are within what one beacon process handled in the 10,000-user run (about 170 per second), so the beacon count is for availability: run at least three. Scaling is adding nodes (and beacons); no code changes.

## What this does not tell you
- **Media and relays.** Nothing here carries video. Relay cost depends on how many connections fail to go direct. The beacon's `chillcall_client_peer_connections_total` metric reports that rate from real clients; size relays from it, not from guesses. At 0.8 Mbps per relayed video stream, every 1% of 100,000 users' connections that needs a relay is on the order of hundreds of Mbps.
- **Redis.** The fleet runs used the beacon's in-memory store. A shared Redis adds a few round trips per join; measure it with `REDIS_URL` set on a staging deployment.
- **Real networks.** Loopback has no latency, loss or TLS. Terminating TLS in front of nodes costs CPU and memory per connection.
- **Real browsers.** The simulated signal bursts approximate ICE traffic but real browsers vary (more candidates on multi-homed machines, restarts after network changes).
- **Beacon CPU and memory** were not scraped separately.
- **Longer runs.** Each run lasted two minutes. Slow leaks and churn effects need an hour-long run with `--churn`; do it on staging before relying on the planning numbers.

## Failure drill on real containers
The same simulated users ran against the small-team stack in Docker (`deploy/team`: beacon, two node containers, a real Redis) while a node container was killed outright with `docker kill` (a hard crash, no goodbye) 40 seconds in:

| | Result |
|---|---|
| Users | 800 in 232 rooms, all admitted (join p99 175 ms) |
| Stranded by the crash | 403 clients, each reconnected exactly once |
| Reconnect time | p99 10.4 s (the registration lapses after 6 s, then clients retry with delays up to 4 s) |
| Left stranded at the end | 0 of 800 |
| Signals lost | 0 of 58,996 (nothing was sent while a peer was unreachable) |

The first run of this drill took 33.6 s at the 99th percentile and counted 1,094 reconnects for 403 clients: a failed attempt against the dead node's address started a second reconnect loop, and the loops multiplied. That bug was in the real app transport as well as the simulator, and is fixed; the in-process drill now asserts exactly one reconnect per stranded client.

## Failure drills
`tools/loadgen/src/chaos.int.test.ts` (run with `pnpm exec vitest run --project "int:loadgen"`) checks behavior under load-like conditions: a node shutting down cleanly (clients back within 10 s), a crash (rooms move after the 6 s registration expiry), a rolling restart, a Redis outage and a beacon outage. What to expect and what to do is in `docs/runbook.md`.
