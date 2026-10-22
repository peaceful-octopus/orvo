import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeAgent } from './agent';
import { MemoryPlacementStore } from './memory';

const base = { id: 'n1', url: 'wss://n1/ws', region: 'r', weight: 1 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(rooms: string[] = []) {
  const store = new MemoryPlacementStore([], () => Date.now());
  const state = { rooms, connections: 3 };
  const errors: unknown[] = [];
  const agent = new NodeAgent(store, base, () => state, {
    heartbeatMs: 1_000,
    nodeTtlMs: 3_000,
    leaseRenewMs: 5_000,
    leaseTtlMs: 12_000,
    onError: (e) => errors.push(e),
  });
  return { store, state, errors, agent };
}

describe('NodeAgent', () => {
  it('registers immediately and keeps the node alive while it runs', async () => {
    const { store, agent } = setup();
    await agent.start();
    expect(await store.listNodes()).toMatchObject([{ id: 'n1', draining: false, connections: 3 }]);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(await store.listNodes()).toHaveLength(1);

    await agent.stop();
  });

  it('deregisters when it stops cleanly', async () => {
    const { store, agent } = setup();
    await agent.start();
    await agent.stop();
    expect(await store.listNodes()).toEqual([]);
  });

  it('reports draining and fresh connection counts on the next heartbeat', async () => {
    const { store, state, agent } = setup();
    await agent.start();
    state.connections = 40;
    await agent.drain();
    expect(await store.listNodes()).toMatchObject([{ draining: true, connections: 40 }]);
    await agent.stop();
  });

  it('renews leases of hosted rooms so they outlive their TTL', async () => {
    const { store, state, agent } = setup(['room-a']);
    await store.acquireLease('room-a', 'n1', 12_000);
    await agent.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await store.getLease('room-a')).toBe('n1');

    state.rooms = [];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await store.getLease('room-a')).toBeUndefined();
    await agent.stop();
  });

  it('reports a room that another node has taken over', async () => {
    const { store, errors, agent } = setup(['room-a']);
    await store.acquireLease('room-a', 'n2', 60_000);
    await agent.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(String(errors[0])).toContain('leased to n2');
    await agent.stop();
  });

  it('survives store failures and reports them', async () => {
    const { store, errors, agent } = setup();
    vi.spyOn(store, 'registerNode').mockRejectedValue(new Error('redis down'));
    await agent.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(errors.length).toBeGreaterThan(0);
    await agent.stop();
  });
});
