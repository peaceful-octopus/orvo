import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

// Chromium runs with --use-fake-ui-for-media-stream, which also answers the screen picker.

test('a shared screen appears as its own tile for everyone else, beside the bubbles, and stops cleanly @smoke', async ({ context }) => {
  const room = `e2e-share-${Date.now()}`;
  const [ann, bob, cy] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob'), await joinRoom(context, room, 'cy')];
  await expectAllConnected([ann, bob, cy]);

  await ann.getByRole('button', { name: 'Share screen' }).click();
  await expect(ann.getByRole('button', { name: 'Stop sharing' }).first()).toBeVisible();

  for (const viewer of [bob, cy]) {
    const tile = viewer.locator('.screen-tile');
    await expect(tile).toHaveCount(1);
    await expect(tile.locator('figcaption')).toHaveText("ann's screen");
    await expect.poll(() => tile.locator('video').evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0); // pictures arrive
    await expect(viewer.locator('.bubble')).toHaveCount(3); // the bubbles are all still there, beside it
  }
  // The sharer sees a note rather than a mirror of their own screen.
  await expect(ann.locator('.screen-tile[data-self="true"]')).toHaveCount(1);

  await ann.getByRole('button', { name: 'Stop sharing' }).first().click();
  await expect(bob.locator('.screen-tile')).toHaveCount(0);
  await expect(cy.locator('.screen-tile')).toHaveCount(0);
  await expectAllConnected([ann, bob, cy]); // cameras kept flowing throughout
});

test('someone who joins while a screen is being shared sees it, and the camera still reaches them @smoke', async ({ context }) => {
  const room = `e2e-share-late-${Date.now()}`;
  const ann = await joinRoom(context, room, 'ann');
  await ann.getByRole('button', { name: 'Share screen' }).click();
  await expect(ann.locator('.screen-tile[data-self="true"]')).toHaveCount(1);

  const bob = await joinRoom(context, room, 'bob');
  await expect(bob.locator('.screen-tile')).toHaveCount(1);
  await expect.poll(() => bob.locator('.screen-tile video').evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  await expectAllConnected([ann, bob]);
  // Bob's bubble for ann must show her camera, not her screen.
  await expect(bob.locator('.bubble video').nth(1)).toBeVisible();
  const cameraWidth = await bob.locator('.bubble video').nth(1).evaluate((v) => (v as HTMLVideoElement).videoWidth);
  const screenWidth = await bob.locator('.screen-tile video').evaluate((v) => (v as HTMLVideoElement).videoWidth);
  expect(cameraWidth).not.toBe(screenWidth);
});

test('leaving while sharing ends the share for everyone @smoke', async ({ context }) => {
  const room = `e2e-share-leave-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  await ann.getByRole('button', { name: 'Share screen' }).click();
  await expect(bob.locator('.screen-tile')).toHaveCount(1);
  await ann.getByRole('button', { name: 'Leave' }).click();
  await expect(bob.locator('.screen-tile')).toHaveCount(0);
});
