import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

test('room caps at 10, warns above 6, refuses the 11th @scale', async ({ context }) => {
  const room = `e2e-ten-${Date.now()}`;
  const pages = [];
  for (let n = 1; n <= 10; n++) pages.push(await joinRoom(context, room, `p${n}`));

  await expectAllConnected(pages);
  await expect(pages[0]!.locator('.banner')).toContainText('video quality may be degraded');

  const late = await joinRoom(context, room, 'late');
  await expect(late.locator('.error')).toHaveText('This room is full.');
});
