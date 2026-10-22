import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS, MemoryPlacementStore, NoNodesError, placeRoom, rendezvousPick, type NodeInfo } from './placement';

const node = (id: string, extra: Partial<NodeInfo> = {}): NodeInfo => ({
  id,
  region: 'r',
  weight: 1,
  draining: false,
  ...extra,
});
const rooms = Array.from({ length: 5000 }, (_, i) => `room-${i}-abcdefgh`);

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
    const t = 0;
    const store = new MemoryPlacementStore([node('a'), node('b')], () => t);
    const placed = new Map<string, string>();
    for (const room of rooms.slice(0, 200)) placed.set(room, (await placeRoom(store, room)).id);

    store.setNodes(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)));
    for (const [room, id] of placed) expect((await placeRoom(store, room)).id).toBe(id);
  });

  it('rehashes once the lease expires or its node is gone', async () => {
    let t = 0;
    const store = new MemoryPlacementStore([node('a'), node('b')], () => t);
    const first = (await placeRoom(store, 'room-lease-abc')).id;

    store.setNodes([node(first === 'a' ? 'b' : 'a')]);
    expect((await placeRoom(store, 'room-lease-abc')).id).not.toBe(first);

    t += LEASE_TTL_MS + 1;
    store.setNodes([node('z')]);
    expect((await placeRoom(store, 'room-lease-abc')).id).toBe('z');
  });

  it('does not place new rooms on draining nodes but keeps leased rooms on them', async () => {
    const store = new MemoryPlacementStore([node('a'), node('b')]);
    const leased = (await placeRoom(store, 'room-old-abc')).id;
    store.setNodes([node('a', { draining: true }), node('b', { draining: true })]);
    expect((await placeRoom(store, 'room-old-abc')).id).toBe(leased);

    store.setNodes([node('a', { draining: true }), node('b')]);
    for (const room of rooms.slice(0, 50)) expect((await placeRoom(store, `new-${room}`)).id).toBe('b');
  });

  it('throws when no node can take a new room', async () => {
    const store = new MemoryPlacementStore([node('a', { draining: true })]);
    await expect(placeRoom(store, 'room-none-abc')).rejects.toBeInstanceOf(NoNodesError);
  });
});
