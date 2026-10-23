import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * MediaPipe's WebAssembly runtime ships inside its npm package. It is served from our own origin at
 * /mediapipe/wasm in development and copied into the build, so nothing is fetched from a third party at runtime.
 */
const mediapipeWasm = (): Plugin => {
  const wasmDir = path.join(path.dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision')), 'wasm');
  const wanted = (name: string) => /^vision_wasm_(nosimd_)?internal\.(js|wasm)$/.test(name);
  let outDir = 'dist';
  return {
    name: 'mediapipe-wasm',
    configResolved: (config) => void (outDir = path.resolve(config.root, config.build.outDir)),
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const name = path.basename((req.url ?? '').split('?')[0]!);
        const file = path.join(wasmDir, name);
        if (!wanted(name) || !existsSync(file)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      cpSync(wasmDir, path.join(outDir, 'mediapipe', 'wasm'), { recursive: true, filter: (src) => statSync(src).isDirectory() || wanted(path.basename(src)) });
    },
  };
};

/**
 * The dev server labels `.gz` files as already-compressed web content, so the browser unzips the noise model
 * before the filter sees it, and the filter needs the archive itself. Production servers send it as a plain file.
 */
const keepModelArchiveCompressed = (): Plugin => ({
  name: 'keep-model-archive-compressed',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/noise/')) {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => (name.toLowerCase() === 'content-encoding' ? res : setHeader(name, value));
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), keepModelArchiveCompressed(), mediapipeWasm()],
  server: { port: 5173, strictPort: true },
});
