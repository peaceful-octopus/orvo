import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

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
 * Release builds must not carry the Giphy key: it comes from the server's signed config so it can be rotated without
 * a new installer. The app code ignores `VITE_GIPHY_API_KEY` outside development; this fails the build if the value
 * is found in the output anyway, for example after someone reads it somewhere new.
 */
const noBakedGiphyKey = (key: string | undefined): Plugin => ({
  name: 'no-baked-giphy-key',
  apply: 'build',
  closeBundle() {
    if (!key) return;
    const dist = path.resolve('dist');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const file of walk(dist)) {
      if (/\.(js|css|html|map|json|txt)$/.test(file) && readFileSync(file, 'utf8').includes(key)) {
        throw new Error(`The Giphy key from .env.local is in ${path.relative(process.cwd(), file)}. Release builds must get it from the server's config instead.`);
      }
    }
  },
});

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

// The app reports this to the server and to the update check. One source: the root package.json (tools/release).
const appVersion = process.env.ORVO_VERSION ?? (JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version: string }).version;

export default defineConfig(({ mode }) => ({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion) },
  plugins: [react(), keepModelArchiveCompressed(), mediapipeWasm(), noBakedGiphyKey(loadEnv(mode, process.cwd(), 'VITE_').VITE_GIPHY_API_KEY)],
  server: { port: 5173, strictPort: true },
}));
