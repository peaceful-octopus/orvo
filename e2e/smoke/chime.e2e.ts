import { expect, test, type Page } from '@playwright/test';
import { expectAllConnected, expectInCall, joinPair, joinRoom, leaveCall, openSettings } from '../helpers';

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
  await leaveCall(bob);
  await expect.poll(() => chimes(ann)).toBe(3 * OSCILLATORS_PER_CHIME);
  await expect.poll(() => chimes(bob)).toBe(2 * OSCILLATORS_PER_CHIME);

  // Switched off in Settings, a later arrival is silent.
  const dialog = await openSettings(ann);
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
  const [ann, bob] = await joinPair(context, room);
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

test('leaving goes to the start page without reloading, so the leaving chime is not cut off @smoke', async ({ context }) => {
  await context.addInitScript(COUNT_CHIMES);
  const ann = await joinRoom(context, `e2e-chime-noreload-${Date.now()}`, 'ann');
  await expect.poll(() => chimes(ann)).toBe(OSCILLATORS_PER_CHIME);
  await ann.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true)); // a reload would lose this

  await leaveCall(ann);
  await expect(ann.getByRole('button', { name: 'Start a room' })).toBeVisible();
  expect(new URL(ann.url()).pathname).toBe('/');
  expect(await ann.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
  expect(await chimes(ann)).toBe(2 * OSCILLATORS_PER_CHIME);
});

test('leaving lets go of the camera and microphone once the leaving chime is over @smoke', async ({ context }) => {
  // A phone changes its audio mode when the microphone is released, which cuts off a sound that is playing.
  await context.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    (window as unknown as { tracks: MediaStreamTrack[] }).tracks = tracks;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await real(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  const ann = await joinRoom(context, `e2e-chime-release-${Date.now()}`, 'ann');
  await expectInCall(ann);
  const live = () => ann.evaluate(() => (window as unknown as { tracks: MediaStreamTrack[] }).tracks.filter((t) => t.readyState === 'live').length);
  expect(await live()).toBeGreaterThan(0);

  await leaveCall(ann);
  await expect(ann.getByRole('button', { name: 'Start a room' })).toBeVisible();
  expect(await live(), 'still held while the chime plays').toBeGreaterThan(0);
  await expect.poll(live, { timeout: 3000 }).toBe(0);
});
