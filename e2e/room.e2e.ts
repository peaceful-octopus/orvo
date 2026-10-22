import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function joinRoom(context: BrowserContext, room: string, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/r/${room}`);
  await page.getByPlaceholder('Your name').fill(name);
  await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled();
  await page.getByRole('button', { name: 'Join' }).click();
  return page;
}

async function expectAllConnected(pages: Page[]) {
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

test('three peers each receive two remote videos', async ({ context }) => {
  const room = `e2e-three-${Date.now()}`;
  const pages: Page[] = [];
  for (const name of ['ann', 'bob', 'cy']) pages.push(await joinRoom(context, room, name));
  await expectAllConnected(pages);
});

test('room caps at 10, warns above 6, refuses the 11th', async ({ context }) => {
  const room = `e2e-ten-${Date.now()}`;
  const pages: Page[] = [];
  for (let n = 1; n <= 10; n++) pages.push(await joinRoom(context, room, `p${n}`));

  await expectAllConnected(pages);
  await expect(pages[0]!.locator('.banner')).toContainText('video quality may be degraded');

  const late = await joinRoom(context, room, 'late');
  await expect(late.locator('.error')).toHaveText('This room is full.');
});

test('layout buttons arrange bubbles in a row, column and ring', async ({ context }) => {
  const room = `e2e-layout-${Date.now()}`;
  const pages: Page[] = [];
  for (const name of ['ann', 'bob', 'cy']) pages.push(await joinRoom(context, room, name));
  await expectAllConnected(pages);

  const page = pages[0]!;
  const centers = async () => {
    // Wait for the spring animation to settle before measuring.
    await page.waitForTimeout(1500);
    return page.locator('.slot').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }),
    );
  };
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

  await page.getByRole('button', { name: 'Row' }).click();
  const row = await centers();
  expect(spread(row.map((c) => c.y))).toBeLessThanOrEqual(1);
  expect(spread(row.map((c) => c.x))).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Column' }).click();
  const column = await centers();
  expect(spread(column.map((c) => c.x))).toBeLessThanOrEqual(1);
  expect(spread(column.map((c) => c.y))).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Campfire' }).click();
  const ring = await centers();
  expect(spread(ring.map((c) => c.x))).toBeGreaterThan(50);
  expect(spread(ring.map((c) => c.y))).toBeGreaterThan(50);
});
