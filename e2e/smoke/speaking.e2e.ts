import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

// Chromium's fake microphone beeps at intervals, which is enough to make a bubble light up.
test('a bubble glows while its person is speaking, for you and for others, and not while muted @smoke', async ({ context }) => {
  const room = `e2e-speaking-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  // Bob sees ann's bubble light up; ann sees her own.
  const annOnBob = bob.locator('.bubble', { hasText: 'ann' });
  await expect(annOnBob).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });
  const own = ann.locator('.bubble', { hasText: 'ann' });
  await expect(own).toHaveAttribute('data-speaking', 'true', { timeout: 20_000 });

  // Muted, ann is no longer reported as speaking on her screen or on bob's.
  await ann.getByRole('button', { name: 'Mute' }).click();
  await expect(own).toHaveAttribute('data-speaking', 'false', { timeout: 5_000 });
  await expect(annOnBob).toHaveAttribute('data-speaking', 'false', { timeout: 5_000 });
  await bob.waitForTimeout(3000);
  await expect(annOnBob).toHaveAttribute('data-speaking', 'false');
});
