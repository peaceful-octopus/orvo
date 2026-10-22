import { defineConfig } from '@playwright/test';

// Set E2E_BASE_URL to run against an already running server (for example the Docker image) instead of dev servers.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  use: {
    baseURL: external ?? 'http://localhost:5173',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      // --mute-audio silences remote audio so multi-peer tests with the fake device make no sound.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio'],
    },
  },
  // One project per suite so a run can target just the affected slice (`--project=smoke`).
  projects: [
    { name: 'smoke', testDir: 'e2e/smoke', timeout: 60_000, expect: { timeout: 20_000 } },
    { name: 'layout', testDir: 'e2e/layout', timeout: 60_000, expect: { timeout: 20_000 } },
    { name: 'resilience', testDir: 'e2e/resilience', timeout: 90_000, expect: { timeout: 30_000 } },
    // Ten software-encoding tabs on one machine take about a minute to converge.
    { name: 'scale', testDir: 'e2e/scale', timeout: 240_000, expect: { timeout: 90_000 } },
  ],
  webServer: external
    ? undefined
    : [
      { command: 'pnpm --filter @chillcall/server start', url: 'http://localhost:8080/healthz', reuseExistingServer: true },
      { command: 'pnpm --filter @chillcall/app dev', url: 'http://localhost:5173', reuseExistingServer: true },
      ],
});
