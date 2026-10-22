# Noise suppression files

Background noise suppression uses [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) (MIT or Apache-2.0)
through the npm package [`deepfilternet3-noise-filter`](https://www.npmjs.com/package/deepfilternet3-noise-filter)
(MIT or Apache-2.0), which runs the model in an AudioWorklet.

The package does not contain the model or the WebAssembly code. By default it downloads them from a third-party CDN
when a call starts. That is code running on every call, so we serve our own copies instead:

| File | Served at | SHA-256 |
| --- | --- | --- |
| `apps/app/public/noise/v3/pkg/df_bg.wasm` | `/noise/v3/pkg/df_bg.wasm` | `440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432` |
| `apps/app/public/noise/v3/models/DeepFilterNet3_onnx.tar.gz` | `/noise/v3/models/DeepFilterNet3_onnx.tar.gz` | `c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616` |

Both were downloaded unchanged from
`https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v3/` on 2026-10-22. The model archive holds the
upstream DeepFilterNet3 ONNX export (`enc.onnx`, `erb_dec.onnx`, `df_dec.onnx`, `config.ini`). The WebAssembly file is
the package author's build of DeepFilterNet's `libDF`; we have not rebuilt it from source, so its exact origin is
unverified. To remove that trust, build `libDF` for `wasm32` from the upstream repository and replace
`df_bg.wasm` (the package's AudioWorklet calls `df_create`, `df_get_frame_length`, `df_process_frame` and
`df_set_atten_lim`).

`src/noise.ts` points the package at `/noise` on our own origin. These files are about 24 MB, so they are loaded only
when noise suppression is on, and only when a call starts or the setting is turned on.

## Serving notes

- The model must reach the worklet as a gzip file. A server that sends `Content-Encoding: gzip` for `.tar.gz` makes the
  browser unzip it first, and the model then fails to load without any error (the filter passes audio through
  unchanged). The Vite dev server does this, so `apps/app/vite.config.ts` removes the header for `/noise/`. Production
  (`@fastify/static`) and the Tauri app serve the file as it is.
- If the filter cannot load, the call carries on with the plain microphone and shows a notice.
