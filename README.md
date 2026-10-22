# ChillCall

Open-source casual video calls with floating face bubbles, GIF reactions and mood filters. Peer-to-peer over WebRTC.

## Layout
- `apps/app`: React + Vite UI (browser and Tauri)
- `apps/signaling`: PeerJS signaling server
- `packages/rtc`: room transport interface and mesh helpers
- `packages/effects`: canvas effects pipeline (filters, GIFs, reactions)

## Develop
```
pnpm install
pnpm dev        # app + signaling
pnpm test
pnpm typecheck
pnpm lint
```
