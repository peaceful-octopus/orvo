import { createBeaconApp } from '@orvo/beacon';
import { MemoryPlacementStore } from '@orvo/placement';
import { JoinResponse, parseServerMessage } from '@orvo/protocol';
import { SignalingServer } from '@orvo/signaling';
import { signingKey, testKeys } from '@orvo/testkit';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

// The personal server runs the beacon and one signaling node in a process, sharing a store. What the node admits and
// removes must then be what the beacon enforces for a locked room.
const key = testKeys('room-access');
const ROOM = 'family-night-abc123';

let store: MemoryPlacementStore;
let beacon: Awaited<ReturnType<typeof createBeaconApp>>;
let signaling: SignalingServer;
let server: http.Server;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  store = new MemoryPlacementStore([{ id: 'local', region: 'r', weight: 1, draining: false }]);
  beacon = await createBeaconApp({ signingKey: signingKey(key), store, stunUrls: [], rateLimitPerMinute: false, nodesShareStore: true });
  signaling = new SignalingServer({ nodeId: 'local', keys: key.keys, roomAccess: store });
  server = http.createServer();
  signaling.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  signaling.close();
  await new Promise((resolve) => server.close(resolve));
  await beacon.close();
});

const join = (body: object) => beacon.inject({ method: 'POST', url: '/v1/rooms/join', payload: body, headers: { host: 'orvo.test' } });

/** Connects to the node with what the beacon issued and waits for the welcome. */
async function enter(session: JoinResponse): Promise<void> {
  const ws = new WebSocket(`ws://localhost:${(server.address() as AddressInfo).port}/ws`);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ v: 1, type: 'join', token: session.joinToken, name: 'x' })));
    ws.on('message', (data) => {
      const parsed = parseServerMessage(String(data));
      if (parsed.ok && parsed.message.type === 'welcome') resolve();
      if (parsed.ok && parsed.message.type === 'error') reject(new Error(parsed.message.code));
    });
    ws.on('error', reject);
  });
}

describe('a locked room on the personal server', () => {
  it('readmits who the node let in, and not someone who was only handed a token', async () => {
    const inside = (await join({ room: ROOM })).json() as JoinResponse;
    await enter(inside); // the node admits this person
    const onlyAsked = (await join({ room: ROOM })).json() as JoinResponse; // got a token, never connected

    const record = (await store.getRoom(ROOM))!;
    await store.updateRoom(ROOM, { ...record, locked: true }, 1e9); // the owner locks the room

    expect((await join({ room: ROOM, resume: inside.resumeToken })).statusCode).toBe(200);
    const refused = await join({ room: ROOM, resume: onlyAsked.resumeToken });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('room-locked');
  });
});
