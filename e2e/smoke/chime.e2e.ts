import { expect, test, type Page } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

/** Counts the oscillators the app starts; only the chime makes them. */
const COUNT_CHIMES = () => {
  const w = window as unknown as { __chimes: number };
  w.__chimes = 0;
  const original = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function (this: AudioContext) {
    w.__chimes += 1;
    return original.call(this);
  };
};
const chimes = (page: Page) => page.evaluate(() => (window as unknown as { __chimes: number }).__chimes);

test('a chime plays when someone joins or leaves, not for people already there, and can be turned off @smoke', async ({ context }) => {
  await context.addInitScript(COUNT_CHIMES);
  const room = `e2e-chime-${Date.now()}`;
  const ann = await joinRoom(context, room, 'ann');
  await expect(ann.locator('.bubble')).toHaveCount(1);
  expect(await chimes(ann)).toBe(0);

  const bob = await joinRoom(context, room, 'bob');
  await expectAllConnected([ann, bob]);
  // Ann hears bob arrive. Bob arrived to a room with ann in it and hears nothing.
  await expect.poll(() => chimes(ann)).toBeGreaterThan(0);
  expect(await chimes(bob)).toBe(0);

  const heard = await chimes(ann);
  await bob.getByRole('button', { name: 'Leave' }).click();
  await expect.poll(() => chimes(ann)).toBeGreaterThan(heard);

  // Switched off in Settings, a later arrival is silent.
  await ann.getByRole('button', { name: 'Settings' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByLabel('Play a soft chime when someone joins or leaves')).toBeChecked();
  await dialog.getByLabel('Play a soft chime when someone joins or leaves').uncheck();
  await ann.keyboard.press('Escape');
  const silent = await chimes(ann);
  const cy = await joinRoom(context, room, 'cy');
  await expect(ann.locator('.bubble')).toHaveCount(2);
  await ann.waitForTimeout(1000);
  expect(await chimes(ann)).toBe(silent);
  await cy.close();
});
