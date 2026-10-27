import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

test('changing your name in Settings updates it for everyone during the call @smoke', async ({ context }) => {
  const room = `e2e-rename-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  await expect(bob.locator('figcaption', { hasText: 'ann' })).toBeVisible();

  await ann.getByRole('button', { name: 'Settings' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Your name').fill('Annabel');
  await expect(ann.locator('figcaption', { hasText: 'Annabel' })).toBeVisible(); // immediately for yourself
  await expect(bob.locator('figcaption', { hasText: 'Annabel' })).toBeVisible(); // and shortly after for others
  await expect(bob.locator('figcaption', { hasText: /^ann$/ })).toHaveCount(0);

  // A person who joins later sees the new name too.
  const cy = await joinRoom(context, room, 'cy');
  await expect(cy.locator('figcaption', { hasText: 'Annabel' })).toBeVisible();
});

test('settings are remembered and the name is used in the lobby @smoke', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Your name').fill('Zed');
  await dialog.getByRole('button', { name: 'Light', exact: true }).click();
  await dialog.getByLabel('Noise suppression strength').fill('35');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.goto('/r/e2e-settings-remembered');
  await expect(page.getByPlaceholder('Your name')).toHaveValue('Zed');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Noise suppression strength')).toHaveValue('35');
});

test('when the noise model cannot load, the call continues with the plain microphone @smoke', async ({ context }) => {
  await context.route('**/noise/**', (route) => route.abort()); // the model files cannot be fetched
  const room = `e2e-noise-fallback-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]); // noise suppression is on by default
  await expect(ann.getByRole('alert').filter({ hasText: 'Noise suppression could not start' })).toBeVisible();

  await ann.getByRole('button', { name: 'Settings' }).click();
  await expect(ann.getByRole('status').filter({ hasText: 'noise filter could not start' })).toBeVisible();
  await ann.getByLabel('Reduce background noise and typing sounds').uncheck();
  await expect(ann.getByLabel('Noise suppression strength')).toBeDisabled();
  await expect(ann.getByRole('status').filter({ hasText: 'extra processing power' })).toBeVisible();
  await expectAllConnected([ann, bob]);
});
