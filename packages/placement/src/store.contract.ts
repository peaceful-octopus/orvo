import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeInfo, PlacementStore } from './types';

const node = (id: string, extra: Partial<NodeInfo> = {}): NodeInfo => ({
  id,
  region: 'r',
  weight: 1,
  draining: false,
  ...extra,
});

export interface StoreHarness {
  store: PlacementStore;
  /** Moves time forward so TTLs elapse. */
  advance(ms: number): Promise<void>;
}

/** Behavior every PlacementStore must have, run against the memory and Redis implementations. */
export function describeStoreContract(name: string, make: () => Promise<StoreHarness>) {
  describe(`${name} PlacementStore contract`, () => {
    let h: StoreHarness;
    beforeEach(async () => {
      h = await make();
    });

    it('lists registered nodes and forgets deregistered or expired ones', async () => {
      await h.store.registerNode(node('a', { url: 'wss://a/ws' }), 15_000);
      await h.store.registerNode(node('b'), 5_000);
      expect((await h.store.listNodes()).map((n) => n.id).sort()).toEqual(['a', 'b']);
      expect((await h.store.listNodes()).find((n) => n.id === 'a')?.url).toBe('wss://a/ws');

      await h.advance(6_000);
      expect((await h.store.listNodes()).map((n) => n.id)).toEqual(['a']);

      await h.store.deregisterNode('a');
      expect(await h.store.listNodes()).toEqual([]);
    });

    it('re-registering updates a node in place', async () => {
      await h.store.registerNode(node('a', { draining: false, connections: 1 }), 15_000);
      await h.store.registerNode(node('a', { draining: true, connections: 9 }), 15_000);
      expect(await h.store.listNodes()).toMatchObject([{ id: 'a', draining: true, connections: 9 }]);
    });

    it('gives a free lease to the first taker and reports the owner to everyone else', async () => {
      expect(await h.store.acquireLease('r1', 'a', 60_000)).toBe('a');
      expect(await h.store.acquireLease('r1', 'b', 60_000)).toBe('a');
      expect(await h.store.getLease('r1')).toBe('a');
    });

    it('lets a lease expire', async () => {
      await h.store.acquireLease('r1', 'a', 1_000);
      await h.advance(1_500);
      expect(await h.store.getLease('r1')).toBeUndefined();
      expect(await h.store.acquireLease('r1', 'b', 60_000)).toBe('b');
    });

    it('takes a lease over only from the owner it names', async () => {
      await h.store.acquireLease('r1', 'a', 60_000);
      expect(await h.store.acquireLease('r1', 'c', 60_000, 'someone-else')).toBe('a');
      expect(await h.store.acquireLease('r1', 'c', 60_000, 'a')).toBe('c');
      expect(await h.store.getLease('r1')).toBe('c');
    });

    it('renews only its own lease, and takes a free one', async () => {
      await h.store.acquireLease('r1', 'a', 2_000);
      expect(await h.store.renewLease('r1', 'a', 10_000)).toBe('a');
      await h.advance(5_000);
      expect(await h.store.getLease('r1')).toBe('a');

      expect(await h.store.renewLease('r1', 'b', 10_000)).toBe('a');
      expect(await h.store.getLease('r1')).toBe('a');

      expect(await h.store.renewLease('free-room', 'b', 10_000)).toBe('b');
      expect(await h.store.getLease('free-room')).toBe('b');
    });

    it('creates a room once, and the first record wins', async () => {
      const first = { owner: 'acct-1', signedInOnly: true, createdAt: 1 };
      expect(await h.store.getRoom('r1')).toBeUndefined();
      expect(await h.store.createRoom('r1', first, 5_000)).toEqual(first);
      const second = { signedInOnly: false, createdAt: 2 };
      expect(await h.store.createRoom('r1', second, 5_000)).toEqual(first); // the later creator reads the winner's record
      expect(await h.store.getRoom('r1')).toEqual(first);
    });

    it('lets a room record expire, keeps it alive when touched, and frees the name afterwards', async () => {
      await h.store.createRoom('r1', { signedInOnly: true, createdAt: 1 }, 2_000);
      await h.advance(1_500);
      await h.store.touchRoom('r1', 2_000);
      await h.advance(1_500);
      expect(await h.store.getRoom('r1')).toBeDefined();
      await h.advance(1_000);
      expect(await h.store.getRoom('r1')).toBeUndefined();
      const fresh = { signedInOnly: false, createdAt: 9 };
      expect(await h.store.createRoom('r1', fresh, 2_000)).toEqual(fresh);
    });

    it('updates a room only while it exists', async () => {
      expect(await h.store.updateRoom('gone', { signedInOnly: true, createdAt: 1 }, 2_000)).toBe(false);
      expect(await h.store.getRoom('gone')).toBeUndefined();
      await h.store.createRoom('r1', { owner: 'a', signedInOnly: false, createdAt: 1 }, 5_000);
      expect(await h.store.updateRoom('r1', { owner: 'a', signedInOnly: true, createdAt: 1 }, 5_000)).toBe(true);
      expect((await h.store.getRoom('r1'))?.signedInOnly).toBe(true);
    });

    it('remembers a room tier until it expires', async () => {
      expect(await h.store.getRoomTier('r1')).toBeUndefined();
      await h.store.setRoomTier('r1', 'full', 2_000);
      expect(await h.store.getRoomTier('r1')).toBe('full');
      await h.advance(2_500);
      expect(await h.store.getRoomTier('r1')).toBeUndefined();
    });
  });
}
