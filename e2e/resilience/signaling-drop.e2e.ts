import { expect, test, type WebSocketRoute } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

const METRICS = `${process.env.E2E_BASE_URL ?? 'http://localhost:8080'}/metrics`;

async function counter(request: import('@playwright/test').APIRequestContext, name: string) {
  const text = await (await request.get(METRICS)).text();
  const match = text.match(new RegExp(`^${name} (\\d+)$`, 'm'));
  return match ? Number(match[1]) : 0;
}

test('media keeps flowing and the room recovers when the signaling socket drops @resilience', async ({
  context,
  request,
}) => {
  const room = `e2e-drop-${Date.now()}`;

  // Ann's signaling socket goes through a route we can cut on demand.
  const annPage = await context.newPage();
  const routes: WebSocketRoute[] = [];
  const servers: WebSocketRoute[] = [];
  await annPage.routeWebSocket(/\/ws$/, (ws) => {
    routes.push(ws);
    servers.push(ws.connectToServer());
  });
  await annPage.goto(`/r/${room}`);
  await annPage.getByPlaceholder('Your name').fill('ann');
  await expect(annPage.getByRole('button', { name: 'Join' })).toBeEnabled();
  await annPage.getByRole('button', { name: 'Join' }).click();

  const bob = await joinRoom(context, room, 'bob');
  await expectAllConnected([annPage, bob]);

  const bobSeesAnnTime = () =>
    bob.locator('.bubble video').evaluateAll((videos) => (videos[1] as HTMLVideoElement).currentTime);
  const before = await bobSeesAnnTime();
  const resumesBefore = await counter(request, 'chillcall_signaling_resumes_total');

  // Cut the signaling connection from both ends.
  for (const route of routes) void route.close();
  for (const server of servers) void server.close();

  // Ann reconnects under the same peer id, so the node records a resume and Bob never sees her leave.
  await expect.poll(() => counter(request, 'chillcall_signaling_resumes_total')).toBeGreaterThan(resumesBefore);
  await expect(annPage.locator('.banner', { hasText: 'Reconnecting' })).toBeHidden();
  await expect(bob.locator('.bubble')).toHaveCount(2);
  await expect.poll(bobSeesAnnTime).toBeGreaterThan(before);

  // Peer-to-peer messages never needed signaling: Ann's mute reaches Bob.
  await annPage.getByRole('button', { name: 'Mute' }).click();
  await expect(bob.locator('.bubble figcaption', { hasText: '(muted)' })).toBeVisible();

  // The resumed signaling connection still relays offers: a newcomer can reach Ann.
  const cy = await joinRoom(context, room, 'cy');
  await expectAllConnected([annPage, bob, cy]);
});
