import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

const videoWidth = (viewer: import('@playwright/test').Page) =>
  viewer.locator('.screen-tile video').evaluate((v) => (v as HTMLVideoElement).videoWidth);

test('a screen can be shared, stopped and shared again, by the same person and by others @smoke', async ({ context }) => {
  const room = `e2e-share-again-${Date.now()}`;
  const [ann, bob, cy] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob'), await joinRoom(context, room, 'cy')];
  await expectAllConnected([ann, bob, cy]);

  const share = async (sharer: import('@playwright/test').Page, viewers: import('@playwright/test').Page[]) => {
    await sharer.getByRole('button', { name: 'Share screen' }).click();
    for (const viewer of viewers) {
      await expect(viewer.locator('.screen-tile')).toHaveCount(1);
      await expect.poll(() => videoWidth(viewer), { message: 'the shared picture arrives' }).toBeGreaterThan(0);
    }
  };
  const stop = async (sharer: import('@playwright/test').Page, viewers: import('@playwright/test').Page[]) => {
    await sharer.getByRole('button', { name: 'Stop sharing' }).first().click();
    for (const viewer of viewers) await expect(viewer.locator('.screen-tile')).toHaveCount(0);
  };

  for (let round = 1; round <= 3; round++) {
    await share(ann, [bob, cy]);
    await stop(ann, [bob, cy]);
  }
  // Someone else can share after Ann has, and then Ann can share again.
  await share(bob, [ann, cy]);
  await stop(bob, [ann, cy]);
  await share(ann, [bob, cy]);
  await stop(ann, [bob, cy]);
  await expectAllConnected([ann, bob, cy]);
});
