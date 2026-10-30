import { expect, test } from '@playwright/test';
import { joinRoom } from '../helpers';

test('pop-up menus stay inside a narrow portrait screen @smoke', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  try {
    const page = await joinRoom(context, `e2e-popover-${Date.now()}`, 'ann');
    for (const name of ['Microphone options', 'Camera options']) {
      await page.getByRole('button', { name }).click();
      const box = await page.locator('.popover').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
      await page.keyboard.press('Escape');
      await expect(page.locator('.popover')).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});
