import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

test('connections between browsers on one machine are detected as direct @tiers', async ({ context }) => {
  const room = `e2e-direct-${Date.now()}`;
  const pages = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected(pages);

  for (const page of pages) {
    // Only the other person's bubble carries a route; it is read from the connection's selected candidate pair.
    await expect(page.locator('.bubble[data-route="direct"]')).toHaveCount(1);
    await expect(page.locator('.bubble[data-route="relay"]')).toHaveCount(0);
    await expect(page.locator('.relay-badge')).toHaveCount(0);
  }
});

test('a free room has no relay, so forcing one makes the peer unreachable with an explanation @tiers', async ({ context }) => {
  const room = `e2e-norelay-${Date.now()}`;
  const bob = await joinRoom(context, room, 'bob');
  const ann = await joinRoom(context, room, 'ann', '?ice=relay'); // asks for relay-only connections

  await expect(ann.locator('.banner[role="alert"]')).toContainText("Can't connect to bob");
  await expect(ann.locator('.bubble figcaption', { hasText: "(can't connect)" })).toBeVisible();
  await expect(ann.locator('.bubble[data-route="relay"]')).toHaveCount(0);

  // Bob can still use the app normally; nothing else in the room is affected.
  await expect(bob.getByRole('button', { name: 'Leave' })).toBeVisible();
});
