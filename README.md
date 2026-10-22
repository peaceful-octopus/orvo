# ChillCall

Open-source casual video calls with floating face bubbles, GIF reactions and mood filters. Peer-to-peer over WebRTC.

## Layout
- `apps/app`: React + Vite UI (browser and Tauri)
- `apps/desktop`: Tauri v2 shell (needs Rust and, on Windows, WebView2)
- `apps/signaling`: PeerJS signaling server
- `packages/protocol`: wire contracts, tokens, signed config (see `docs/architecture.md`)
- `packages/testkit`: test factories
- `packages/rtc`: room transport interface and mesh helpers
- `packages/effects`: canvas effects pipeline (filters, GIFs, reactions)

## Develop
```
pnpm install
pnpm dev        # app + signaling
pnpm test            # unit tests related to uncommitted changes only
pnpm test:rtc        # one package (also test:protocol, test:signaling, test:app)
pnpm test:all        # every unit test
pnpm test:e2e        # smoke + layout, about 20 s; test:e2e:scale is the slow 10-peer run
pnpm --filter @chillcall/desktop dev   # desktop app; run `pnpm dev` first
pnpm typecheck
pnpm lint
```
