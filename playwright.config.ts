import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 240_000,
  workers: 1,
  expect: { timeout: 90_000 },
  use: {
    baseURL: 'http://localhost:5173',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: [
    { command: 'pnpm --filter @chillcall/signaling start', url: 'http://localhost:9000/rooms/health-check', reuseExistingServer: true },
    { command: 'pnpm --filter @chillcall/app dev', url: 'http://localhost:5173', reuseExistingServer: true },
  ],
});
