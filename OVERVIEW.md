# Orvo: developer overview

Open-source casual video calls with floating face bubbles, GIF reactions and mood filters. Peer-to-peer over WebRTC.

## Layout
- `apps/app`: React + Vite UI (browser and Tauri)
- `apps/desktop`: Tauri v2 shell (needs Rust and, on Windows, WebView2)
- `apps/server`: all-in-one server (web app + beacon + signaling), the Docker image
- `deploy/`: compose files for personal, small-team and relay (coturn) setups
- `apps/beacon`: room creation, placement, join tokens, signed config, TURN credentials by tier
- `apps/signaling`: WebSocket signaling node
- `packages/protocol`: wire contracts, tokens, signed config (see `docs/architecture.md`)
- `packages/metrics`: Prometheus metrics wrapper shared by the services
- `tools/loadgen`: simulated-user load generator and failure drills (see `docs/capacity.md`)
- `packages/placement`: node registry, room leases and rendezvous placement (memory and Redis)
- `packages/testkit`: test factories
- `tools/sign-config`: key generation and config signing CLI
- `packages/rtc`: room transport interface and mesh helpers
- `packages/effects`: canvas effects (emoji reactions, GIFs) drawn into your outgoing video
- `apps/server/activities`: activities the server offers in calls (Snake); how they work is in `docs/activities.md`

## Run it
```
cd deploy/personal && docker compose up -d   # http://localhost:8080
```
See `docs/self-hosting.md`.

## Develop
```
pnpm install
pnpm dev        # app (5173) + all-in-one server (8080)
pnpm test            # unit tests related to uncommitted changes only
pnpm test:rtc        # one package (also test:protocol, test:signaling, test:app)
pnpm test:all        # every unit test
pnpm test:e2e        # smoke + layout, about 20 s; also test:e2e:effects, test:e2e:resilience, test:e2e:tiers, test:e2e:fleet, test:e2e:scale
pnpm test:integration   # multi-node fleet scenarios and failure drills (set REDIS_URL to use a real Redis)
pnpm load:fleet         # local beacon + 3 nodes under simulated load (see docs/runbook.md)
pnpm --filter @orvo/desktop dev   # desktop app; run `pnpm dev` first
pnpm test:e2e:readme    # retakes the pictures in README.md (docs/screenshots)
pnpm typecheck
pnpm lint
```
