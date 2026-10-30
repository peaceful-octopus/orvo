import { expect, test } from '@playwright/test';
import { joinRoom } from '../helpers';

// The campfire glow is larger than the ring, and must not make the page scroll.
for (const [width, height] of [[780, 1200], [400, 600]] as const) {
  test(`a call with two people does not scroll at ${width}x${height} @smoke`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    try {
      const room = `e2e-no-scroll-${width}-${Date.now()}`;
      const page = await joinRoom(context, room, 'ann');
      await joinRoom(context, room, 'bob');
      await expect(page.locator('.bubble')).toHaveCount(2);
      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return { x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight };
      });
      expect(overflow).toEqual({ x: 0, y: 0 });
    } finally {
      await context.close();
    }
  });
}
