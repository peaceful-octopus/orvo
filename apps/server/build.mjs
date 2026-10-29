// Bundles the server and the workspace packages it uses (which are shipped as TypeScript source) into dist/main.js.
// Third-party dependencies stay external and are installed next to it, so native and dynamically loaded modules keep working.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
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
