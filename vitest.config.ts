import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** One unit-test project per package, so a change runs only the projects it touches. */
const unit = (name: string, path: string) => ({
  test: {
    name,
    root: dir(path),
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', '**/node_modules/**'],
  },
});

/** Integration tests (`*.int.test.ts`) need external services such as Redis and are run on demand. */
const integration = (name: string, path: string) => ({
  // Against a real Redis the contract tests wait out real TTLs, so allow more than the 5 s default.
  test: { name: `int:${name}`, root: dir(path), include: ['src/**/*.int.test.ts'], passWithNoTests: true, testTimeout: 30_000 },
});

export default defineConfig({
  test: {
    projects: [
      integration('placement', './packages/placement'),
      integration('fleet', './apps/server'),
      integration('loadgen', './tools/loadgen'),
      unit('protocol', './packages/protocol'),
      unit('testkit', './packages/testkit'),
      unit('placement', './packages/placement'),
      unit('effects', './packages/effects'),
      unit('rtc', './packages/rtc'),
      unit('signaling', './apps/signaling'),
      unit('beacon', './apps/beacon'),
      unit('sign-config', './tools/sign-config'),
      unit('loadgen', './tools/loadgen'),
      unit('server', './apps/server'),
      unit('app', './apps/app'),
    ],
  },
});
