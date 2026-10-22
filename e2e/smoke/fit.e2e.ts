import { expect, test } from '@playwright/test';

// The app's default window is 1000 x 700, about 1000 x 670 inside its title bar. No screen may need scrolling there,
// or in a small window, even with the long names real cameras and rooms have.

const SIZES = [
  { width: 1000, height: 670 },
  { width: 700, height: 520 },
  { width: 390, height: 760 },
];

const overflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));

for (const size of SIZES) {
  test(`the landing page, lobby and call fit a ${size.width}x${size.height} window without scrolling @smoke`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, permissions: ['camera', 'microphone'] });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start a room' })).toBeVisible();
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });

    await page.goto('/r/brook-river-velvet-q4x7mz2k');
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const hint = document.querySelector('details.devices .hint');
      if (hint) hint.textContent = 'System default (Webcam Microphone (HD Pro Webcam C920)) · HD Pro Webcam C920 (046d:082d) with a very long name';
    });
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });

    await page.getByPlaceholder('Your name').fill('joel');
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible();
    expect(await overflow(page)).toEqual({ x: 0, y: 0 });
    await context.close();
  });
}
