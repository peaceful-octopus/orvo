import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Gives every page in the context the same stored settings to start from: the noise filter off, so its CPU use stays out
 * of tests that are not about it, plus anything in `settings`. It only fills in what is missing, so choices a test makes
 * through the settings screen survive later page loads. Tests that are about the noise filter set their own.
 */
export async function seedSettings(context: BrowserContext, settings: Record<string, unknown> = {}) {
  await context.addInitScript((extra) => {
    if (localStorage.getItem('orvo:settings')) return;
    localStorage.setItem('orvo:settings', JSON.stringify({ state: { noise: { enabled: false }, ...extra }, version: 0 }));
  }, settings);
}

export async function joinRoom(context: BrowserContext, room: string, name: string, query = ''): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/r/${room}${query}`);
  await page.getByPlaceholder('Your name').fill(name);
  await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled();
  await page.getByRole('button', { name: 'Join' }).click();
  return page;
}

export async function expectAllConnected(pages: Page[]) {
  for (const page of pages) {
    await expect(page.locator('.bubble')).toHaveCount(pages.length);
    await expect
      .poll(() =>
        page.locator('.bubble video').evaluateAll((videos) =>
          videos.every((v) => (v as HTMLVideoElement).videoWidth > 0),
        ),
      )
      .toBe(true);
  }
}
