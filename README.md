# ChillCall

Open-source casual video calls with floating face bubbles, GIF reactions and mood filters. Peer-to-peer over WebRTC.

## Layout
- `apps/app`: React + Vite UI (browser and Tauri)
- `apps/desktop`: Tauri v2 shell (needs Rust and, on Windows, WebView2)
- `apps/signaling`: PeerJS signaling server
- `packages/rtc`: room transport interface and mesh helpers
- `packages/effects`: canvas effects pipeline (filters, GIFs, reactions)

## Develop
```
pnpm install
pnpm dev        # app + signaling
pnpm test
pnpm test:e2e   # Playwright, starts the servers itself
pnpm --filter @chillcall/desktop dev   # desktop app; run `pnpm dev` first
pnpm typecheck
pnpm lint
```
