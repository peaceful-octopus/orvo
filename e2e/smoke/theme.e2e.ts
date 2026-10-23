import { expect, test } from '@playwright/test';

const root = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    mode: document.documentElement.dataset.mode,
    palette: document.documentElement.dataset.palette,
    bg: getComputedStyle(document.body).backgroundColor,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  }));

test('the interface follows the system light or dark setting by default @smoke', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  expect(await root(page)).toMatchObject({ mode: 'dark', palette: 'evening', bg: 'rgb(27, 23, 20)' });

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await root(page)).mode).toBe('light');
  expect((await root(page)).bg).toBe('rgb(250, 244, 232)');
});

test('Settings switches between light, dark and palettes, and remembers the choice @smoke', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });

  await dialog.getByRole('button', { name: 'Light' }).click();
  await expect.poll(async () => (await root(page)).mode).toBe('light'); // overrides the system's dark
  await dialog.getByLabel('Colour palette').selectOption('midnight');
  await expect.poll(async () => (await root(page)).palette).toBe('midnight');
  expect((await root(page)).accent).toBe('#5A4BEF');

  await dialog.getByLabel('Colour palette').selectOption('beach');
  await expect.poll(async () => (await root(page)).palette).toBe('beach');
  expect((await root(page)).accent).toBe('#A13D63'); // Beach Day's berry, in light mode
  await expect(dialog.getByLabel('Colour palette').locator('option', { hasText: 'Beach Day' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Dark' }).click();
  await expect.poll(async () => (await root(page)).accent).toBe('#F7A278'); // and its peach in dark mode

  await page.reload();
  expect(await root(page)).toMatchObject({ mode: 'dark', palette: 'beach' });
});

test('every colour in the stylesheet comes from the palette @smoke', async ({ page }) => {
  await page.goto('/');
  const literals = await page.evaluate(async () => {
    const found: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        // `transparent` is not a palette colour; a minified build writes it as rgba(0, 0, 0, 0).
        const text = rule.cssText.replace(/url\([^)]*\)/g, '').replace(/rgba\(0, 0, 0, 0\)/g, 'transparent');
        // Colours written out in a rule, other than the transparent keyword and the fallbacks inside var().
        for (const m of text.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)) {
          if (!/var\([^)]*$/.test(text.slice(0, m.index))) found.push(`${rule.cssText.slice(0, 60)} -> ${m[0]}`);
        }
      }
    }
    return found;
  });
  expect(literals).toEqual([]);
});
