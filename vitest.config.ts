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

export default defineConfig({
  test: {
    projects: [
      unit('protocol', './packages/protocol'),
      unit('testkit', './packages/testkit'),
      unit('rtc', './packages/rtc'),
      unit('signaling', './apps/signaling'),
      unit('app', './apps/app'),
    ],
  },
});
