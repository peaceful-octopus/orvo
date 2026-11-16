import { describe, expect, it } from 'vitest';
import { MemoryPlacementStore } from './memory';
import { describeStoreContract } from './store.contract';
import { StoreFullError } from './types';

describeStoreContract('Memory', async () => {
  let now = 0;
  return { store: new MemoryPlacementStore([], () => now), advance: async (ms) => void (now += ms) };
});

describe('Memory store memory use', () => {
  const record = { signedInOnly: false, locked: false, createdAt: 0 };

  it('drops expired entries, not just hides them', async () => {
    let now = 0;
    const store = new MemoryPlacementStore([], () => now);
    for (let i = 0; i < 100; i++) {
      await store.createRoom(`room-${i}`, record, 1000);
      await store.acquireLease(`room-${i}`, 'n', 1000);
    }
    now = 60_000;
    await store.createRoom('later', record, 1000); // any write after the sweep interval cleans up
    const held = store as unknown as { rooms: Map<string, unknown>; leases: Map<string, unknown> };
    expect(held.rooms.size).toBe(1);
    expect(held.leases.size).toBe(0);
  });

  it('refuses new rooms at the cap, keeps existing ones, and takes more once some expire', async () => {
    let now = 0;
    const store = new MemoryPlacementStore([], () => now, { maxRooms: 3 });
    for (const id of ['a', 'b', 'c']) await store.createRoom(id, record, 1000);
    await expect(store.createRoom('d', record, 1000)).rejects.toBeInstanceOf(StoreFullError);
    expect(await store.createRoom('a', record, 1000)).toEqual(record); // an existing room is still answered
    now = 2000;
    await expect(store.createRoom('d', record, 1000)).resolves.toEqual(record);
  });
});
