import type { Tier } from '@chillcall/protocol';
import { MemoryPlacementStore } from './memory';
import type { NodeInfo, PlacementStore } from './types';

export interface ResilientOptions {
  now?: () => number;
  /** How long the last node list stays usable when the shared store cannot be reached. */
  staleNodesMs?: number;
  onDegraded?: (degraded: boolean, error?: unknown) => void;
}

/**
 * Keeps a beacon useful while the shared store (Redis) is down. It mirrors what it has seen: rooms keep going
 * to the nodes they were on, and new rooms are placed on the last known nodes, with leases held locally. Beacons
 * may briefly disagree about a new room while degraded; that is preferable to refusing every join.
 * Registering nodes is passed through, since nodes already tolerate failures there and refresh on their own.
 */
export class ResilientPlacementStore implements PlacementStore {
  private mirror: MemoryPlacementStore;
  private lastNodes?: { nodes: NodeInfo[]; at: number };
  private now: () => number;
  private staleNodesMs: number;
  private isDegraded = false;

  constructor(
    private inner: PlacementStore,
    private opts: ResilientOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.staleNodesMs = opts.staleNodesMs ?? 5 * 60_000;
    this.mirror = new MemoryPlacementStore([], this.now);
  }

  /** True while the shared store is failing and answers come from what this beacon remembers. */
  get degraded() {
    return this.isDegraded;
  }

  registerNode(node: NodeInfo, ttlMs: number) {
    return this.inner.registerNode(node, ttlMs);
  }

  deregisterNode(id: string) {
    return this.inner.deregisterNode(id);
  }

  async listNodes() {
    try {
      const nodes = await this.inner.listNodes();
      this.lastNodes = { nodes, at: this.now() };
      this.setDegraded(false);
      return nodes;
    } catch (err) {
      // A node list that is too old (or never seen) is not safe to place rooms on, so the failure stands.
      if (!this.lastNodes || this.now() - this.lastNodes.at > this.staleNodesMs) throw err;
      this.setDegraded(true, err);
      return this.lastNodes.nodes;
    }
  }

  async getLease(room: string) {
    return this.guard(
      async () => {
        const owner = await this.inner.getLease(room);
        if (owner) this.mirror.setLease(room, owner, 60_000);
        return owner;
      },
      () => this.mirror.getLease(room),
    );
  }

  async acquireLease(room: string, nodeId: string, ttlMs: number, replaceOwner?: string) {
    return this.guard(
      async () => {
        const owner = await this.inner.acquireLease(room, nodeId, ttlMs, replaceOwner);
        this.mirror.setLease(room, owner, ttlMs);
        return owner;
      },
      () => this.mirror.acquireLease(room, nodeId, ttlMs, replaceOwner),
    );
  }

  async renewLease(room: string, nodeId: string, ttlMs: number) {
    return this.guard(
      async () => {
        const owner = await this.inner.renewLease(room, nodeId, ttlMs);
        this.mirror.setLease(room, owner, ttlMs);
        return owner;
      },
      () => this.mirror.renewLease(room, nodeId, ttlMs),
    );
  }

  async getRoomTier(room: string) {
    return this.guard(
      async () => {
        const tier = await this.inner.getRoomTier(room);
        if (tier) await this.mirror.setRoomTier(room, tier, 3600_000);
        return tier;
      },
      () => this.mirror.getRoomTier(room),
    );
  }

  async setRoomTier(room: string, tier: Tier, ttlMs: number) {
    await this.mirror.setRoomTier(room, tier, ttlMs);
    await this.guard(
      () => this.inner.setRoomTier(room, tier, ttlMs),
      async () => undefined,
    );
  }

  /** Runs `primary`; if the shared store fails, answers from what this beacon remembers. */
  private async guard<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      const result = await primary();
      this.setDegraded(false);
      return result;
    } catch (err) {
      this.setDegraded(true, err);
      return fallback();
    }
  }

  private setDegraded(degraded: boolean, error?: unknown) {
    if (degraded === this.isDegraded) return;
    this.isDegraded = degraded;
    this.opts.onDegraded?.(degraded, error);
  }
}
