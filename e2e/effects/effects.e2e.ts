import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';
import { effectPixels, fakeGiphy, solidClip } from './helpers';

// Reactions and GIFs are drawn into the sender's outgoing video, so the proof is what the *other* person sees.

// These tests time short-lived effects, so keep the noise filter's CPU use out of them (it has its own tests).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('chillcall:settings', JSON.stringify({ state: { noise: { enabled: false, strength: 60 } }, version: 0 }));
  });
});

test('an emoji reaction shows on the sender and, in the video itself, to the other person @effects', async ({ context }) => {
  const room = `e2e-react-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  expect(await effectPixels(bob, 1)).toBeLessThan(50); // nothing on ann's video yet
  expect(await effectPixels(ann, 0)).toBeLessThan(50);

  await ann.getByRole('button', { name: 'React with 🎉' }).click();
  await ann.waitForTimeout(150);
  await ann.getByRole('button', { name: 'React with ❤️' }).click();

  // Both must show it at the same moment; the effect lasts only a few seconds, so look at them together.
  await expect
    .poll(async () => Math.min(await effectPixels(bob, 1), await effectPixels(ann, 0)), { message: 'bob and ann both see the reaction' })
    .toBeGreaterThan(300);

  // Reactions are short; afterwards the plain camera is sent again.
  await expect.poll(() => effectPixels(bob, 1), { timeout: 15_000 }).toBeLessThan(50);
  await expect.poll(() => effectPixels(ann, 0), { timeout: 15_000 }).toBeLessThan(50);

  // And a second reaction works after the first has ended.
  await ann.getByRole('button', { name: 'React with 👏' }).click();
  await expect.poll(() => effectPixels(bob, 1)).toBeGreaterThan(300);
});

test('reactions are unavailable while the camera is off @effects', async ({ context }) => {
  const ann = await joinRoom(context, `e2e-camoff-${Date.now()}`, 'ann');
  await expect(ann.getByRole('button', { name: 'Leave' })).toBeVisible();
  await expect(ann.getByRole('button', { name: 'React with 🎉' })).toBeEnabled();

  await ann.getByRole('button', { name: 'Camera off' }).click();
  await expect(ann.getByRole('button', { name: 'React with 🎉' })).toBeDisabled();
  await ann.getByRole('button', { name: 'Camera on' }).click();
  await expect(ann.getByRole('button', { name: 'React with 🎉' })).toBeEnabled();
});

test('a GIF chosen from the Giphy picker appears on the video for everyone, then goes away @effects', async ({ context }) => {
  const magenta = await solidClip(await context.newPage(), '#ff00ff');
  const giphy = await fakeGiphy(context, magenta);

  const room = `e2e-gif-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  expect(await effectPixels(bob, 1)).toBeLessThan(50);

  await ann.getByRole('button', { name: 'GIF' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Choose a GIF' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Powered by GIPHY')).toBeVisible(); // required attribution
  await expect.poll(() => giphy.apiRequests.length).toBeGreaterThan(0);
  expect(giphy.apiRequests[0]).toContain('api_key=e2e-giphy-key'); // the key the server published

  await dialog.locator('.giphy-gif').first().click();
  await expect(dialog).toBeHidden();

  // A sticker covers part of the frame: clearly visible to bob, but not the whole picture.
  await expect.poll(() => effectPixels(bob, 1), { message: 'bob sees the GIF' }).toBeGreaterThan(1500);
  expect(await effectPixels(bob, 1)).toBeLessThan(160 * 120 * 0.6);

  // It ends by itself and the camera comes back.
  await expect.poll(() => effectPixels(bob, 1), { timeout: 20_000 }).toBeLessThan(50);
  await expect.poll(() => effectPixels(ann, 0), { timeout: 5_000 }).toBeLessThan(50);
});

test('"Replace my video" makes the GIF fill the frame @effects', async ({ context }) => {
  const magenta = await solidClip(await context.newPage(), '#ff00ff');
  await fakeGiphy(context, magenta);

  const room = `e2e-gif-fill-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  await ann.getByRole('button', { name: 'GIF' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Choose a GIF' });
  await dialog.getByLabel('Replace my video').check();
  await dialog.locator('.giphy-gif').first().click();

  await expect.poll(() => effectPixels(bob, 1)).toBeGreaterThan(160 * 120 * 0.7);
});

test('a GIF that cannot be loaded shows a message and leaves the call as it was @effects', async ({ context }) => {
  await fakeGiphy(context, undefined); // the MP4 answers 404

  const room = `e2e-gif-fail-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  await ann.getByRole('button', { name: 'GIF' }).click();
  await ann.getByRole('dialog', { name: 'Choose a GIF' }).locator('.giphy-gif').first().click();

  await expect(ann.getByRole('status').filter({ hasText: 'could not be loaded' })).toBeVisible();
  await ann.waitForTimeout(1500);
  expect(await effectPixels(bob, 1)).toBeLessThan(50);
  await expectAllConnected([ann, bob]); // still connected, video still flowing
});

test('Escape closes the picker without choosing anything @effects', async ({ context }) => {
  await fakeGiphy(context, undefined);
  const ann = await joinRoom(context, `e2e-gif-esc-${Date.now()}`, 'ann');
  await ann.getByRole('button', { name: 'GIF' }).click();
  await expect(ann.getByRole('dialog', { name: 'Choose a GIF' })).toBeVisible();
  await ann.keyboard.press('Escape');
  await expect(ann.getByRole('dialog', { name: 'Choose a GIF' })).toBeHidden();
});
