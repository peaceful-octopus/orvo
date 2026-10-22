import { test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

test('three peers each receive two remote videos @smoke', async ({ context }) => {
  const room = `e2e-three-${Date.now()}`;
  const pages = [];
  for (const name of ['ann', 'bob', 'cy']) pages.push(await joinRoom(context, room, name));
  await expectAllConnected(pages);
});
