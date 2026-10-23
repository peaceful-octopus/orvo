import { expect, test } from '@playwright/test';

// With a server address nothing answers at, the start page offers no way to start or join a room.

test('the start page reports an unreachable server instead of offering to start a room @smoke', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orvo:server', 'http://127.0.0.1:1'));
  await page.goto('/');
  const alert = page.getByRole('alert').filter({ hasText: 'Cannot reach the server' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('http://127.0.0.1:1');
  await expect(page.getByRole('button', { name: /Start a room|Sign in to start a room/ })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Join a room' })).toBeHidden();
});

test('the start page offers a room when the server answers @smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a room' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Cannot reach the server' })).toHaveCount(0);
});
