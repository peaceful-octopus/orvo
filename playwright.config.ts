import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
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
    // Ten software-encoding tabs on one machine take about a minute to converge.
    { name: 'scale', testDir: 'e2e/scale', timeout: 240_000, expect: { timeout: 90_000 } },
  ],
  webServer: [
    { command: 'pnpm --filter @chillcall/signaling start', url: 'http://localhost:9000/rooms/health-check', reuseExistingServer: true },
    { command: 'pnpm --filter @chillcall/app dev', url: 'http://localhost:5173', reuseExistingServer: true },
  ],
});
