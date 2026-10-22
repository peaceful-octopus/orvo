import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { FLEET_KID, FLEET_PUBLIC, FLEET_SECRET } from './e2e/fleet/keys';

// Set E2E_BASE_URL to run against an already running server (for example the Docker image) instead of dev servers.
const external = process.env.E2E_BASE_URL;

// E2E_FLEET=1 runs the fleet suite: a beacon (which also serves the built web app) in front of two separate
// signaling nodes. The keys (e2e/fleet/keys.ts) are for this test only and protect nothing.
const fleet = Boolean(process.env.E2E_FLEET);
const FLEET_PORT = 8180;

const fleetServers = [
  {
    command: 'pnpm --filter @chillcall/beacon start',
    url: `http://localhost:${FLEET_PORT}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(FLEET_PORT),
      SIGNING_KEY: `${FLEET_KID}:${FLEET_SECRET}`,
      WEB_DIR: path.resolve('apps/app/dist'),
      NODES: JSON.stringify([
        { id: 'n1', url: 'ws://localhost:9101/ws' },
        { id: 'n2', url: 'ws://localhost:9102/ws' },
      ]),
    },
  },
  ...[
    ['n1', 9101],
    ['n2', 9102],
  ].map(([id, port]) => ({
    command: 'pnpm --filter @chillcall/signaling start',
    url: `http://localhost:${port}/healthz`,
    reuseExistingServer: false,
    env: { PORT: String(port), NODE_ID: String(id), TRUSTED_KEYS: JSON.stringify({ [FLEET_KID]: FLEET_PUBLIC }) },
  })),
];

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  use: {
    baseURL: fleet ? `http://localhost:${FLEET_PORT}` : (external ?? 'http://localhost:5173'),
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
    { name: 'tiers', testDir: 'e2e/tiers', timeout: 90_000, expect: { timeout: 45_000 } },
    { name: 'fleet', testDir: 'e2e/fleet', timeout: 90_000, expect: { timeout: 30_000 } },
    // Ten software-encoding tabs on one machine take about a minute to converge.
    { name: 'scale', testDir: 'e2e/scale', timeout: 240_000, expect: { timeout: 90_000 } },
  ],
  webServer: fleet
    ? fleetServers
    : external
      ? undefined
      : [
          { command: 'pnpm --filter @chillcall/server start', url: 'http://localhost:8080/healthz', reuseExistingServer: true },
          { command: 'pnpm --filter @chillcall/app dev', url: 'http://localhost:5173', reuseExistingServer: true },
        ],
});
