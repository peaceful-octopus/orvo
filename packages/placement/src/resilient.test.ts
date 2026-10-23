import { describe, expect, it } from 'vitest';
import { MemoryPlacementStore } from './memory';
import { placeRoom } from './place';
import { ResilientPlacementStore } from './resilient';
import type { NodeInfo, PlacementStore } from './types';

const node = (id: string): NodeInfo => ({ id, region: 'r', weight: 1, draining: false });

/** A store that can be switched off, to stand in for Redis going away. */
function flaky(inner: PlacementStore) {
  const state = { down: false };
  const wrap =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...args: A) => {
      if (state.down) throw new Error('connection refused');
      return fn(...args);
    };
  const store: PlacementStore = {
    registerNode: wrap(inner.registerNode.bind(inner)),
    deregisterNode: wrap(inner.deregisterNode.bind(inner)),
    listNodes: wrap(inner.listNodes.bind(inner)),
    getLease: wrap(inner.getLease.bind(inner)),
    acquireLease: wrap(inner.acquireLease.bind(inner)),
    renewLease: wrap(inner.renewLease.bind(inner)),
    getRoomTier: wrap(inner.getRoomTier.bind(inner)),
    setRoomTier: wrap(inner.setRoomTier.bind(inner)),
    getRoom: wrap(inner.getRoom.bind(inner)),
    createRoom: wrap(inner.createRoom.bind(inner)),
    touchRoom: wrap(inner.touchRoom.bind(inner)),
    updateRoom: wrap(inner.updateRoom.bind(inner)),
  };
  return { store, state };
}

function setup(opts: { staleNodesMs?: number } = {}) {
  let t = 0;
  const events: boolean[] = [];
  const backing = new MemoryPlacementStore([node('a'), node('b'), node('c')], () => t);
  const { store, state } = flaky(backing);
  const resilient = new ResilientPlacementStore(store, { now: () => t, onDegraded: (d) => events.push(d), ...opts });
  return { resilient, state, events, advance: (ms: number) => void (t += ms) };
}

describe('ResilientPlacementStore', () => {
  it('behaves like the underlying store while it is healthy', async () => {
    const { resilient, events } = setup();
    const placed = await placeRoom(resilient, 'room-one-abc');
    expect(await resilient.getLease('room-one-abc')).toBe(placed.id);
    expect(resilient.degraded).toBe(false);
    expect(events).toEqual([]);
  });

  it('keeps routing existing rooms to the same node during an outage', async () => {
    const { resilient, state } = setup();
    const rooms = Array.from({ length: 30 }, (_, i) => `room-${i}-abcdef`);
    const before = new Map<string, string>();
    for (const room of rooms) before.set(room, (await placeRoom(resilient, room)).id);

    state.down = true;
    for (const room of rooms) expect((await placeRoom(resilient, room)).id).toBe(before.get(room));
    expect(resilient.degraded).toBe(true);
  });

  it('places new rooms on the last known nodes and keeps them there', async () => {
    const { resilient, state } = setup();
    await resilient.listNodes(); // learn the nodes while healthy
    state.down = true;

    const first = await placeRoom(resilient, 'brand-new-room-abc');
    expect(['a', 'b', 'c']).toContain(first.id);
    for (let i = 0; i < 5; i++) expect((await placeRoom(resilient, 'brand-new-room-abc')).id).toBe(first.id);
  });

  it('recovers and stops reporting degraded once the store is back', async () => {
    const { resilient, state, events } = setup();
    await resilient.listNodes();
    state.down = true;
    await placeRoom(resilient, 'room-x-abcdef');
    expect(events).toEqual([true]);

    state.down = false;
    await resilient.listNodes();
    expect(resilient.degraded).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it('refuses to place rooms on a node list that is too old, or was never seen', async () => {
    const { resilient, state, advance } = setup({ staleNodesMs: 1000 });
    state.down = true;
    await expect(resilient.listNodes()).rejects.toThrow('connection refused'); // nothing learned yet

    state.down = false;
    await resilient.listNodes();
    state.down = true;
    advance(2000);
    await expect(resilient.listNodes()).rejects.toThrow('connection refused');
  });

  it('remembers room tiers through an outage', async () => {
    const { resilient, state } = setup();
    await resilient.setRoomTier('paid-room-abc', 'full', 60_000);
    state.down = true;
    expect(await resilient.getRoomTier('paid-room-abc')).toBe('full');
    await resilient.setRoomTier('other-room-abc', 'relay-lite', 60_000); // does not throw while the store is down
    expect(await resilient.getRoomTier('other-room-abc')).toBe('relay-lite');
  });

  it('does not hide node registration failures from the node agent', async () => {
    const { resilient, state } = setup();
    state.down = true;
    await expect(resilient.registerNode(node('d'), 1000)).rejects.toThrow('connection refused');
  });

  it('keeps the owner and access rules of a room usable while the shared store is down', async () => {
    const { resilient, state } = setup();
    const record = { owner: 'acct-1', signedInOnly: true, locked: false, createdAt: 1 };
    expect(await resilient.createRoom('room-abc', record, 60_000)).toEqual(record);
    state.down = true;
    expect(await resilient.getRoom('room-abc')).toEqual(record); // remembered from before the outage
    const fresh = { signedInOnly: false, locked: false, createdAt: 2 };
    expect(await resilient.createRoom('new-room-abc', fresh, 60_000)).toEqual(fresh); // new rooms still work
    expect(await resilient.updateRoom('room-abc', { ...record, signedInOnly: false }, 60_000)).toBe(true);
    await resilient.touchRoom('room-abc', 60_000); // does not throw
  });
});
