import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

test('layout buttons arrange bubbles in a row, column and ring @layout', async ({ context }) => {
  const room = `e2e-layout-${Date.now()}`;
  const pages = [];
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

  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitemradio', { name: 'Row' }).click();
  const row = await centers();
  expect(spread(row.map((c) => c.y))).toBeLessThanOrEqual(1);
  expect(spread(row.map((c) => c.x))).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitemradio', { name: 'Column' }).click();
  const column = await centers();
  expect(spread(column.map((c) => c.x))).toBeLessThanOrEqual(1);
  expect(spread(column.map((c) => c.y))).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitemradio', { name: 'Campfire' }).click();
  const ring = await centers();
  expect(spread(ring.map((c) => c.x))).toBeGreaterThan(50);
  expect(spread(ring.map((c) => c.y))).toBeGreaterThan(50);
});
