# Camera effects and screen sharing

## Mood filters, background blur and keeping you in frame

All three are drawn onto your camera picture before it is sent, so everyone sees the result and nothing extra is
signalled between peers. `packages/effects` holds the drawing (`Compositor`) and when it runs (`EffectsController`):
the compositor is used only while a filter, blur, framing or a reaction is on, and the plain camera is sent otherwise.

- **Filters** are data in `packages/effects/src/filters.ts` (a CSS colour grade, an optional gradient and a vignette).
- **Blur and framing** use MediaPipe through `apps/app/src/vision.ts`. The face detector finds your face, and
  `framing.ts` turns it into a smoothly moving crop (up to 1.9x, with a dead band so the picture holds still). The
  person segmenter produces a mask; you are cut out of the picture and drawn over a blurred copy of it.
- The models run on the GPU when they can and on the CPU otherwise. Until a model has loaded, the unprocessed camera
  is shown rather than a half-finished picture.

### Files

| File | Source | SHA-256 |
| --- | --- | --- |
| `apps/app/public/mediapipe/models/blaze_face_short_range.tflite` | `storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/` | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |
| `apps/app/public/mediapipe/models/selfie_segmenter.tflite` | `storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/` | `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b` |

Both were downloaded unchanged on 2026-10-22 (MediaPipe models are Apache-2.0). The WebAssembly runtime is not
committed: `@mediapipe/tasks-vision` carries it, and `apps/app/vite.config.ts` serves it at `/mediapipe/wasm` in
development and copies it into the build. Nothing is fetched from a third party at runtime.

Automated tests on machines without a real GPU set `window.__visionDelegate = 'CPU'`, because software-emulated graphics
stall the page.

## Screen sharing

A shared screen travels to each peer as extra tracks on the same connection, apart from the camera's. Because both are
video, the receiver cannot tell them apart from the tracks alone, so the sharer sends a `screen` message on the data
channel naming the id of the stream that carries the screen (and `null` when it stops). The message is replayed to
people who join later, like mute and camera state. A receiver treats the named stream as the screen and the other as
the camera.

- The screen is drawn as a tile beside the bubbles, taking the left side of a wide window or the top of a tall one
  (`splitForScreens` in `apps/app/src/float/layouts.ts`). The sharer sees a note with a stop button instead of a mirror.
- The screen's tracks carry `contentHint = 'detail'` and follow the same send limits as the camera, so a large room
  does not get more bandwidth because someone is sharing.
- The floating view shows bubbles only; shared screens appear when the window is docked.
