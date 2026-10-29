import { expect, test, type Page } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

/** Counts the oscillators the app starts; only the chime makes them. An entry or exit chime starts four. */
const OSCILLATORS_PER_CHIME = 4;
// The count lives in sessionStorage because leaving a call reloads the page.
const COUNT_CHIMES = () => {
  const original = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function (this: AudioContext) {
    sessionStorage.setItem('chimes', String(Number(sessionStorage.getItem('chimes') ?? 0) + 1));
    return original.call(this);
  };
};
const chimes = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem('chimes') ?? 0));

test('a chime plays when someone joins or leaves, not for people already there, and can be turned off @smoke', async ({ context }) => {
  await context.addInitScript(COUNT_CHIMES);
  const room = `e2e-chime-${Date.now()}`;
  const ann = await joinRoom(context, room, 'ann');
  await expect(ann.locator('.bubble')).toHaveCount(1);
  // Connecting to the room chimes once, even though nobody else is there.
  await expect.poll(() => chimes(ann)).toBe(OSCILLATORS_PER_CHIME);

  const bob = await joinRoom(context, room, 'bob');
  await expectAllConnected([ann, bob]);
  // Ann hears bob arrive. Bob hears only his own arrival, not a chime for ann, who was already there.
  await expect.poll(() => chimes(ann)).toBe(2 * OSCILLATORS_PER_CHIME);
  await bob.waitForTimeout(1000);
  expect(await chimes(bob)).toBe(OSCILLATORS_PER_CHIME);

  // Leaving chimes for bob and for ann, once each.
  await bob.getByRole('button', { name: 'Leave' }).click();
  await expect.poll(() => chimes(ann)).toBe(3 * OSCILLATORS_PER_CHIME);
  await expect.poll(() => chimes(bob)).toBe(2 * OSCILLATORS_PER_CHIME);

  // Switched off in Settings, a later arrival is silent.
  await ann.getByRole('button', { name: 'Settings' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByLabel('Play entry and exit chime')).toBeChecked();
  await dialog.getByLabel('Play entry and exit chime').uncheck();
  await ann.keyboard.press('Escape');
  const silent = await chimes(ann);
  const cy = await joinRoom(context, room, 'cy');
  await expect(ann.locator('.bubble')).toHaveCount(2);
  await ann.waitForTimeout(1000);
  expect(await chimes(ann)).toBe(silent);
  await cy.close();
});

test('a chime plays when someone else starts or ends an activity, and not for your own @smoke', async ({ context }) => {
  await context.addInitScript(COUNT_CHIMES);
  const room = `e2e-chime-activity-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  // An activity starting just after you arrive is taken to be one that was already running.
  await ann.waitForTimeout(7000);
  const [annBefore, bobBefore] = [await chimes(ann), await chimes(bob)];

  await ann.getByRole('button', { name: 'Activities' }).click();
  await ann.getByRole('menuitem', { name: /Snake/ }).click();
  await expect(ann.locator('.activity-tile')).toBeVisible();
  await expect.poll(() => chimes(bob)).toBeGreaterThan(bobBefore);
  expect(await chimes(ann)).toBe(annBefore);

  const bobHeard = await chimes(bob);
  await ann.getByRole('button', { name: 'Activities' }).click();
  await ann.getByRole('menuitem', { name: 'End for everyone' }).click();
  await expect.poll(() => chimes(bob)).toBeGreaterThan(bobHeard);
  expect(await chimes(ann)).toBe(annBefore);
});
