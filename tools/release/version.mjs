// One version for the whole release: the root package.json is the source, and the desktop shell's own files must
// match it. `node tools/release/version.mjs check` fails when they differ; `set 1.2.3` writes them all.
// The app reads the version from the root package.json at build time (apps/app/vite.config.ts), so it needs no copy.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = (p) => join(root, p);
const SEMVER = /^\d+\.\d+\.\d+$/; // numbers only: the Windows installer (MSI) and the app's version comparison need them

/** Every place that carries the version, with how to read it and how to rewrite it. */
const targets = [
  {
    path: 'package.json',
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]*(")/, `$1${v}$2`),
  },
  {
    path: 'apps/desktop/package.json',
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]*(")/, `$1${v}$2`),
  },
  {
    path: 'apps/desktop/src-tauri/tauri.conf.json',
    read: (s) => JSON.parse(s).version,
    write: (s, v) => s.replace(/("version":\s*")[^"]*(")/, `$1${v}$2`),
  },
  {
    path: 'apps/desktop/src-tauri/Cargo.toml',
    read: (s) => /^version\s*=\s*"([^"]*)"/m.exec(s)?.[1],
    write: (s, v) => s.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${v}$2`),
  },
  {
    path: 'apps/desktop/src-tauri/Cargo.lock',
    read: (s) => /name = "orvo"\r?\nversion = "([^"]*)"/.exec(s)?.[1],
    write: (s, v) => s.replace(/(name = "orvo"\r?\nversion = ")[^"]*(")/, `$1${v}$2`),
  },
];

const [command, version] = process.argv.slice(2);

if (command === 'check') {
  const source = targets[0].read(readFileSync(file(targets[0].path), 'utf8'));
  const stale = targets.filter((t) => t.read(readFileSync(file(t.path), 'utf8')) !== source);
  if (!SEMVER.test(source)) stale.push({ path: `package.json ("${source}" is not x.y.z)` });
  if (stale.length) {
    console.error(`Version ${source} (package.json) does not match:\n${stale.map((t) => `  ${t.path}`).join('\n')}\nRun: pnpm version:set ${source}`);
    process.exit(1);
  }
  console.log(`All versions are ${source}.`);
} else if (command === 'set' && version) {
  if (!SEMVER.test(version)) {
    console.error(`"${version}" is not a version like 1.2.3.`);
    process.exit(1);
  }
  for (const t of targets) {
    const before = readFileSync(file(t.path), 'utf8');
    const after = t.write(before, version);
    if (t.read(after) !== version) throw new Error(`Could not set the version in ${t.path}.`);
    if (after !== before) writeFileSync(file(t.path), after);
  }
  console.log(`Set ${version} in ${targets.length} files. Commit, then tag v${version}.`);
} else {
  console.error('Usage: node tools/release/version.mjs check | set <x.y.z>');
  process.exit(1);
}
