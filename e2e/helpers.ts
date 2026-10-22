import { expect, type BrowserContext, type Page } from '@playwright/test';

export async function joinRoom(context: BrowserContext, room: string, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/r/${room}`);
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
