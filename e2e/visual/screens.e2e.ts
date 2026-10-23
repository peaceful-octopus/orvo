import { test } from '@playwright/test';

// Not a pass/fail check: it photographs the main screens in every palette and mode, for reviewing a design change.
// Run with `pnpm test:e2e:visual`; the pictures are written to test-results/screens.

const VARIANTS = [
  ['evening', 'dark'],
  ['evening', 'light'],
  ['midnight', 'dark'],
  ['midnight', 'light'],
  ['beach', 'dark'],
  ['beach', 'light'],
] as const;

for (const [palette, mode] of VARIANTS) {
  test(`screens in ${palette} ${mode} @visual`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 760 },
      permissions: ['camera', 'microphone'],
    });
    await context.addInitScript(
      ([p, m]) => {
        localStorage.setItem(
          'chillcall:settings',
          JSON.stringify({ state: { palette: p, mode: m, name: 'Joel', noise: { enabled: false, strength: 60 } }, version: 0 }),
        );
      },
      [palette, mode],
    );
    const page = await context.newPage();
    const shot = (name: string) => page.screenshot({ path: `test-results/screens/${palette}-${mode}-${name}.png` });
    const room = `visual-${palette}-${mode}-${Date.now()}`;

    await page.goto('/');
    await shot('1-landing');

    await page.goto(`/r/${room}`);
    await page.getByRole('button', { name: 'Join' }).waitFor();
    await shot('2-lobby');
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await page.getByRole('button', { name: 'Leave' }).waitFor();
    await shot('3-call-alone');

    const other = await context.newPage();
    await other.goto(`/r/${room}`);
    await other.getByPlaceholder('Your name').fill('Sam');
    await other.getByRole('button', { name: 'Join', exact: true }).click();
    await page.locator('.bubble').nth(1).waitFor();
    await page.getByRole('button', { name: 'Microphone options' }).click();
    await shot('4-call-menu');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Settings' }).click();
    await shot('5-settings');
    await context.close();
  });
}
