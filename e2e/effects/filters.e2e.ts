import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';
import { saturation, sharpness } from './helpers';

// The fake camera is solid green, so a filter that removes colour is easy to see in what the other person receives.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    (window as unknown as { __visionDelegate: string }).__visionDelegate = 'CPU'; // headless test machines have no real GPU
    // Only the first page of the test gets this, so choices made during the test carry over to later pages.
    if (!localStorage.getItem('chillcall:settings')) {
      localStorage.setItem('chillcall:settings', JSON.stringify({ state: { noise: { enabled: false, strength: 60 } }, version: 0 }));
    }
  });
});

const choose = async (page: import('@playwright/test').Page, label: string) => {
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('menuitemradio', { name: label }).click();
  await page.keyboard.press('Escape');
};

test('a mood filter changes the video for everyone, and None brings the camera back @effects', async ({ context }) => {
  const room = `e2e-filter-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  expect(await saturation(bob, 1)).toBeGreaterThan(0.5); // plain green

  await choose(ann, 'Noir');
  await expect.poll(() => saturation(bob, 1), { message: 'bob sees ann in black and white' }).toBeLessThan(0.1);
  expect(await saturation(ann, 0)).toBeLessThan(0.1); // and ann sees herself the same way

  await choose(ann, 'None');
  await expect.poll(() => saturation(bob, 1)).toBeGreaterThan(0.5);
  await expectAllConnected([ann, bob]);
});

test('the filter stays on through reactions, changing the microphone and changing the camera @effects', async ({ context }) => {
  const room = `e2e-filter-stay-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  await choose(ann, 'Noir');
  await expect.poll(() => saturation(bob, 1)).toBeLessThan(0.1);

  // A reaction is drawn on top; when it ends the filter is still there.
  await ann.getByRole('button', { name: 'React with 🎉' }).click();
  await ann.waitForTimeout(6000);
  await expect.poll(() => saturation(bob, 1)).toBeLessThan(0.1);

  // Switching microphone replaces the audio track; the video must keep its filter.
  await ann.getByRole('button', { name: 'Microphone options' }).click();
  const mics = ann.getByRole('group', { name: 'Microphone' }).getByRole('menuitemradio');
  await mics.nth((await mics.count()) - 1).click();
  await ann.keyboard.press('Escape');
  await ann.waitForTimeout(1500);
  await expect.poll(() => saturation(bob, 1)).toBeLessThan(0.1);

  // Switching camera starts a new picture; the filter is applied to it.
  await ann.getByRole('button', { name: 'Camera options' }).click();
  const cameras = ann.getByRole('group', { name: 'Camera' }).getByRole('menuitemradio');
  await cameras.nth((await cameras.count()) - 1).click();
  await ann.keyboard.press('Escape');
  await ann.waitForTimeout(1500);
  await expect.poll(() => saturation(bob, 1)).toBeLessThan(0.1);
  await expectAllConnected([ann, bob]);
});

test('the chosen filter is remembered and applied when the next call starts @effects', async ({ context }) => {
  const first = await joinRoom(context, `e2e-filter-first-${Date.now()}`, 'ann');
  await choose(first, 'Noir');
  await first.close();

  const room = `e2e-filter-next-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  await expect(ann.getByRole('button', { name: 'Filters' })).toHaveClass(/on/);
  await expect.poll(() => saturation(bob, 1)).toBeLessThan(0.1);
});

test('blurring the background softens the picture everyone receives, and turning it off restores it @effects', async ({ context }) => {
  const room = `e2e-blur-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  const sharp = async () => {
    // Average a few frames: the fake camera animates.
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      sum += await sharpness(bob, 1);
      await bob.waitForTimeout(120);
    }
    return sum / 5;
  };
  const plain = await sharp();
  expect(plain).toBeGreaterThan(1);

  await ann.getByRole('button', { name: 'Filters' }).click();
  await ann.getByRole('menuitemcheckbox', { name: 'Blur background' }).click();
  await ann.keyboard.press('Escape');
  // The fake camera has no person in it, so everything counts as background and is blurred.
  await expect.poll(sharp, { timeout: 40_000, message: 'the picture bob receives gets softer' }).toBeLessThan(plain * 0.6);
  await expect(ann.getByRole('button', { name: 'Filters' })).toHaveClass(/on/);

  await ann.getByRole('button', { name: 'Filters' }).click();
  await ann.getByRole('menuitemcheckbox', { name: 'Blur background' }).click();
  await ann.keyboard.press('Escape');
  await expect.poll(sharp).toBeGreaterThan(plain * 0.85);
  await expectAllConnected([ann, bob]);
});

test('keeping me in frame can be switched on and off without disturbing the call @effects', async ({ context }) => {
  const room = `e2e-frame-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  await ann.getByRole('button', { name: 'Filters' }).click();
  const frame = ann.getByRole('menuitemcheckbox', { name: 'Keep me in frame' });
  await frame.click();
  await expect(frame).toHaveAttribute('aria-checked', 'true');
  await ann.keyboard.press('Escape');
  await ann.waitForTimeout(2500); // the fake camera has no face, so the picture stays whole and keeps flowing
  await expectAllConnected([ann, bob]);
  expect(await saturation(bob, 1)).toBeGreaterThan(0.5);

  await ann.getByRole('button', { name: 'Filters' }).click();
  await frame.click();
  await expect(frame).toHaveAttribute('aria-checked', 'false');
});
