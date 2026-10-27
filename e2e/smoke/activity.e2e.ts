import { expect, test, type Page } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

async function startSnake(page: Page) {
  await page.getByRole('button', { name: 'Activities' }).click();
  await page.getByRole('menuitem', { name: /Snake/ }).click();
}

async function openRunning(page: Page) {
  await page.getByRole('button', { name: 'Activities' }).click();
  await page.getByRole('menuitem', { name: 'Open it' }).click();
}

test('one person starts Snake, another opens it, and a turn from the guest reaches the host @smoke', async ({ context }) => {
  const room = `e2e-snake-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  await startSnake(ann);
  const annFrame = ann.frameLocator('.activity-tile iframe');
  await expect(annFrame.locator('canvas')).toBeVisible();
  await expect(annFrame.locator('#status')).toContainText('1 player here');

  // Bob is told something is running but it does not open by itself.
  await expect(bob.locator('.activity-tile')).toHaveCount(0);
  await expect(bob.locator('.controls .dot')).toBeVisible();
  await openRunning(bob);
  const bobFrame = bob.frameLocator('.activity-tile iframe');
  await expect(bob.locator('.activity-tile figcaption')).toHaveText('Snake (started by ann)');
  await expect(bobFrame.locator('#status')).toContainText('Waiting for ann to start');
  await expect(annFrame.locator('#status')).toContainText('2 players here');
  await expect(annFrame.locator('#scores .chip')).toHaveCount(2);

  // The host starts the round and both see it running.
  await expect(bobFrame.getByRole('button', { name: 'Start' })).toBeHidden();
  await annFrame.getByRole('button', { name: 'Start' }).click();
  await expect(bobFrame.locator('#status')).toContainText('Steer with the arrow keys');

  // Snakes start in the top and bottom rows. Bob turns toward the nearer wall, so he is out within a second, and
  // the host can only know that if his key press travelled to it.
  const chips = await annFrame.locator('#scores .chip').allTextContents();
  const bobOnTop = chips.findIndex((text) => text.startsWith('bob')) === 0;
  await bobFrame.locator('canvas').click();
  await bob.keyboard.press(bobOnTop ? 'ArrowUp' : 'ArrowDown');
  await expect(annFrame.locator('#status')).toContainText('ann wins', { timeout: 10_000 });
  await expect(bobFrame.locator('#status')).toContainText('ann wins');
  await expect(annFrame.locator('#scores .chip.out')).toHaveCount(1);

  // Only the host can start the next round.
  await expect(annFrame.getByRole('button', { name: 'Play again' })).toBeVisible();
  await expect(bobFrame.getByRole('button', { name: 'Play again' })).toBeHidden();

  // The host leaving ends it for everyone else.
  await ann.getByRole('button', { name: 'Leave' }).click();
  await expect(bob.locator('.activity-tile')).toHaveCount(0);
});

test('someone who joins later can open the running activity, and the host can end it for everyone @smoke', async ({ context }) => {
  const room = `e2e-snake-late-${Date.now()}`;
  const ann = await joinRoom(context, room, 'ann');
  await startSnake(ann);
  await expect(ann.frameLocator('.activity-tile iframe').locator('canvas')).toBeVisible();

  const bob = await joinRoom(context, room, 'bob');
  await expectAllConnected([ann, bob]);
  await openRunning(bob);
  const bobFrame = bob.frameLocator('.activity-tile iframe');
  await expect(bobFrame.locator('#status')).toContainText('Waiting for ann to start');

  // A guest can close their own copy without ending it for the others.
  await bob.getByRole('button', { name: 'Close' }).click();
  await expect(bob.locator('.activity-tile')).toHaveCount(0);
  await expect(ann.locator('.activity-tile')).toHaveCount(1);
  await expect(ann.frameLocator('.activity-tile iframe').locator('#status')).toContainText('1 player here');

  await openRunning(bob);
  await expect(bob.locator('.activity-tile')).toHaveCount(1);

  await ann.getByRole('button', { name: 'Activities' }).click();
  await ann.getByRole('menuitem', { name: 'End for everyone' }).click();
  await expect(ann.locator('.activity-tile')).toHaveCount(0);
  await expect(bob.locator('.activity-tile')).toHaveCount(0);

  // After it ends, a new one can start.
  await startSnake(bob);
  await expect(bob.locator('.activity-tile')).toHaveCount(1);
});

test('the activity frame is sandboxed from the app @smoke', async ({ context }) => {
  const room = `e2e-snake-sandbox-${Date.now()}`;
  const ann = await joinRoom(context, room, 'ann');
  await startSnake(ann);
  const iframe = ann.locator('.activity-tile iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const frame = ann.frames().find((f) => f.url().includes('/activities/snake/'));
  expect(frame).toBeDefined();
  // No origin of its own: the app's storage and cookies are out of reach.
  await expect.poll(() => frame!.evaluate(() => window.origin)).toBe('null');
  const storage = await frame!.evaluate(() => {
    const attempt = (read: () => unknown) => {
      try {
        read();
        return 'allowed';
      } catch {
        return 'blocked';
      }
    };
    return { local: attempt(() => localStorage.length), cookie: attempt(() => document.cookie) };
  });
  expect(storage).toEqual({ local: 'blocked', cookie: 'blocked' });
  // And it cannot contact anything, including the server it came from.
  const reached = await frame!.evaluate(() => fetch('/v1/keys').then(() => true, () => false));
  expect(reached).toBe(false);
});
