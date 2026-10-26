import { expect, test } from '@playwright/test';

test('a room can be joined by name or by pasted link from the landing page @smoke', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Room name or link').fill('Movie Night');
  await page.getByRole('button', { name: 'Join a room' }).click();
  await expect(page).toHaveURL(/\/r\/movie-night$/);

  await page.goto('/');
  await page.getByLabel('Room name or link').fill('http://localhost:8080/r/pasted-link-room?x=1');
  await page.getByRole('button', { name: 'Join a room' }).click();
  await expect(page).toHaveURL(/\/r\/pasted-link-room$/);
});

test('the landing page rejects a name that cannot be a room @smoke', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Room name or link').fill('no_underscores!');
  await page.getByRole('button', { name: 'Join a room' }).click();
  await expect(page.getByText('Enter a room name')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('the call view copies a link to the room @smoke', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/r/copy-link-room');
  await page.getByPlaceholder('Your name').fill('ann');
  await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled();
  await page.getByRole('button', { name: 'Join' }).click();

  await page.getByRole('button', { name: 'Copy room link' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/r\/copy-link-room$/);
});
