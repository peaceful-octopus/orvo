import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

const BEACON = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

/** Sum of a labeled counter in the beacon's /metrics output, whatever order Prometheus prints the labels in. */
async function counter(request: APIRequestContext, name: string, labels: Record<string, string>) {
  const text = await (await request.get(`${BEACON}/metrics`)).text();
  return text
    .split('\n')
    .filter((line) => line.startsWith(`${name}{`))
    .filter((line) => Object.entries(labels).every(([k, v]) => line.includes(`${k}="${v}"`)))
    .reduce((sum, line) => sum + Number(line.split(' ').pop()), 0);
}

const direct = { result: 'connected', route: 'direct' };

test('connection statistics reach the beacon when people leave a call @tiers', async ({ context, request }) => {
  const before = await counter(request, 'orvo_client_peer_connections_total', direct);
  const room = `e2e-telemetry-${Date.now()}`;
  const pages = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected(pages);

  // Leaving the page flushes the queue (pagehide / visibilitychange), so no 30 s wait is needed.
  for (const page of pages) await page.goto('about:blank');

  // Each side reports the connection it made, as direct, with no names or room ids in the metrics.
  await expect.poll(() => counter(request, 'orvo_client_peer_connections_total', direct)).toBeGreaterThanOrEqual(before + 2);
  const text = await (await request.get(`${BEACON}/metrics`)).text();
  expect(text).not.toContain(room);
  expect(await counter(request, 'orvo_client_joins_total', { result: 'ok' })).toBeGreaterThanOrEqual(2);
});

test('nothing is reported once the user opts out @tiers', async ({ context, request }) => {
  await context.addInitScript(() => localStorage.setItem('orvo:telemetry', 'off'));
  const before = {
    peers: await counter(request, 'orvo_client_peer_connections_total', {}),
    joins: await counter(request, 'orvo_client_joins_total', {}),
  };

  const room = `e2e-optout-${Date.now()}`;
  const pages = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected(pages);
  for (const page of pages) await page.goto('about:blank');
  await new Promise((r) => setTimeout(r, 3000));

  expect(await counter(request, 'orvo_client_peer_connections_total', {})).toBe(before.peers);
  expect(await counter(request, 'orvo_client_joins_total', {})).toBe(before.joins);
});
