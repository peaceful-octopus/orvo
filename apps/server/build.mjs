// Bundles the server and the workspace packages it uses (which are shipped as TypeScript source) into dist/main.js.
// The standalone beacon and signaling node that the small-team setup runs as separate containers are bundled beside it.
// Third-party dependencies stay external and are installed next to it, so native and dynamically loaded modules keep working.
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main.ts', beacon: '../beacon/src/main.ts', signaling: '../signaling/src/main.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  plugins: [
    {
      name: 'external-third-party',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith('@orvo/') ? undefined : { path: args.path, external: true }));
      },
    },
  ],
});
