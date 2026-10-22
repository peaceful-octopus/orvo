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
  test: { name: `int:${name}`, root: dir(path), include: ['src/**/*.int.test.ts'], passWithNoTests: true },
});

export default defineConfig({
  test: {
    projects: [
      integration('placement', './packages/placement'),
      integration('fleet', './apps/server'),
      unit('protocol', './packages/protocol'),
      unit('testkit', './packages/testkit'),
      unit('placement', './packages/placement'),
      unit('rtc', './packages/rtc'),
      unit('signaling', './apps/signaling'),
      unit('beacon', './apps/beacon'),
      unit('sign-config', './tools/sign-config'),
      unit('app', './apps/app'),
    ],
  },
});
