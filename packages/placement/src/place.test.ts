import { describe, expect, it } from 'vitest';
import { MemoryPlacementStore } from './memory';
import { placeRoom, rendezvousPick } from './place';
import { LEASE_TTL_MS, NoNodesError, type NodeInfo } from './types';

const node = (id: string, extra: Partial<NodeInfo> = {}): NodeInfo => ({
  id,
  region: 'r',
  weight: 1,
  draining: false,
  ...extra,
});
const rooms = Array.from({ length: 5000 }, (_, i) => `room-${i}-abcdefgh`);

const withNodes = (nodes: NodeInfo[], store: MemoryPlacementStore) =>
  Promise.all(nodes.map((n) => store.registerNode(n, Infinity)));

describe('rendezvousPick', () => {
  it('is deterministic', () => {
    const nodes = [node('a'), node('b'), node('c')];
    expect(rendezvousPick('room-x-abc', nodes)?.id).toBe(rendezvousPick('room-x-abc', [...nodes].reverse())?.id);
  });

  it('spreads rooms roughly evenly', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id));
    const counts = new Map<string, number>();
    for (const room of rooms) {
      const id = rendezvousPick(room, nodes)!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.size).toBe(5);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(rooms.length / 5 - 200);
      expect(count).toBeLessThan(rooms.length / 5 + 200);
    }
  });

  it('only moves the rooms of a removed node', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => node(id));
    const without = nodes.filter((n) => n.id !== 'c');
    for (const room of rooms) {
      const before = rendezvousPick(room, nodes)!.id;
      const after = rendezvousPick(room, without)!.id;
      if (before !== 'c') expect(after).toBe(before);
    }
  });

  it('moves about 1/N of rooms when a node is added', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => node(id));
    const more = [...nodes, node('e')];
    const moved = rooms.filter((r) => rendezvousPick(r, nodes)!.id !== rendezvousPick(r, more)!.id).length;
    expect(moved).toBeGreaterThan(rooms.length / 5 - 250);
    expect(moved).toBeLessThan(rooms.length / 5 + 250);
  });

  it('gives heavier nodes proportionally more rooms', () => {
    const nodes = [node('small'), node('big', { weight: 3 })];
    const big = rooms.filter((r) => rendezvousPick(r, nodes)!.id === 'big').length;
    expect(big / rooms.length).toBeGreaterThan(0.7);
    expect(big / rooms.length).toBeLessThan(0.8);
  });
});

describe('placeRoom', () => {
  it('keeps a room on its leased node when nodes are added', async () => {
    const store = new MemoryPlacementStore([], () => 0);
    await withNodes([node('a'), node('b')], store);
    const placed = new Map<string, string>();
    for (const room of rooms.slice(0, 200)) placed.set(room, (await placeRoom(store, room)).id);

    await withNodes(['c', 'd', 'e', 'f'].map((id) => node(id)), store);
    for (const [room, id] of placed) expect((await placeRoom(store, room)).id).toBe(id);
  });

  it('takes the lease over from a dead owner so later placements agree', async () => {
    const store = new MemoryPlacementStore([], () => 0);
    await withNodes([node('a'), node('b')], store);
    const first = (await placeRoom(store, 'room-lease-abc')).id;
    const other = first === 'a' ? 'b' : 'a';

    await store.deregisterNode(first);
    expect((await placeRoom(store, 'room-lease-abc')).id).toBe(other);
    expect(await store.getLease('room-lease-abc')).toBe(other);

    await withNodes([node(first)], store); // the old node returns; the room stays where it moved
    expect((await placeRoom(store, 'room-lease-abc')).id).toBe(other);
  });

  it('rehashes once an unrenewed lease expires', async () => {
    let t = 0;
    const store = new MemoryPlacementStore([], () => t);
    await withNodes([node('a')], store);
    expect((await placeRoom(store, 'room-expire-abc')).id).toBe('a');

    t += LEASE_TTL_MS + 1;
    await store.deregisterNode('a');
    await withNodes([node('z')], store);
    expect((await placeRoom(store, 'room-expire-abc')).id).toBe('z');
  });

  it('does not place new rooms on draining nodes but keeps leased rooms on them', async () => {
    const store = new MemoryPlacementStore([], () => 0);
    await withNodes([node('a'), node('b')], store);
    const leased = (await placeRoom(store, 'room-old-abc')).id;
    await withNodes([node('a', { draining: true }), node('b', { draining: true })], store);
    expect((await placeRoom(store, 'room-old-abc')).id).toBe(leased);

    await withNodes([node('a', { draining: true }), node('b')], store);
    for (const room of rooms.slice(0, 50)) expect((await placeRoom(store, `new-${room}`)).id).toBe('b');
  });

  it('throws when no node can take a new room', async () => {
    const store = new MemoryPlacementStore([node('a', { draining: true })]);
    await expect(placeRoom(store, 'room-none-abc')).rejects.toBeInstanceOf(NoNodesError);
  });
});
