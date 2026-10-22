import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

test('rooms on different signaling nodes both work, and each room stays on one node @fleet', async ({ context, request }) => {
  // Find two rooms that the beacon places on different nodes.
  const nodeFor = async (room: string) =>
    ((await (await request.post('/v1/rooms/join', { data: { room } })).json()) as { signalingUrl: string }).signalingUrl;

  const rooms: Record<string, string> = {};
  for (let i = 0; Object.keys(rooms).length < 2 && i < 50; i++) {
    const room = `fleet-room-${Date.now()}-${i}`;
    const node = await nodeFor(room);
    if (!Object.values(rooms).includes(node)) rooms[node] = room;
  }
  expect(Object.keys(rooms)).toHaveLength(2);
  const [roomA, roomB] = Object.values(rooms) as [string, string];

  const a = [await joinRoom(context, roomA, 'ann'), await joinRoom(context, roomA, 'bob')];
  const b = [await joinRoom(context, roomB, 'cy'), await joinRoom(context, roomB, 'dee')];
  await expectAllConnected(a);
  await expectAllConnected(b);

  // The beacon keeps answering with the same node for a room that is in use.
  for (const [node, room] of Object.entries(rooms)) expect(await nodeFor(room)).toBe(node);
});

test('the app verifies the beacon config against its signature and caches it @fleet', async ({ context, request }) => {
  const config = await (await request.get('/v1/config')).json();
  expect(config).toMatchObject({ kid: 'fleet-test', sig: expect.any(String) });

  const page = await joinRoom(context, `fleet-cache-${Date.now()}`, 'ann');
  await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible(); // in the call, so config has loaded
  // The cache is only written after the signature verified against the beacon's keys.
  const cached = await page.evaluate(() => localStorage.getItem('chillcall:config'));
  expect(JSON.parse(cached!)).toMatchObject({ signed: { kid: 'fleet-test' }, keys: { 'fleet-test': expect.any(String) } });
});
