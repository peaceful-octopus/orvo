import type { Tier } from '@chillcall/protocol';
import type { NodeInfo, PlacementStore } from './types';

interface Expiring<T> {
  value: T;
  expires: number;
}

/** In-process store for the all-in-one server, a single beacon, and tests. */
export class MemoryPlacementStore implements PlacementStore {
  private nodes = new Map<string, Expiring<NodeInfo>>();
  private leases = new Map<string, Expiring<string>>();
  private tiers = new Map<string, Expiring<Tier>>();

  constructor(
    initialNodes: NodeInfo[] = [],
    private now: () => number = Date.now,
  ) {
    for (const node of initialNodes) this.nodes.set(node.id, { value: node, expires: Infinity });
  }

  async registerNode(node: NodeInfo, ttlMs: number) {
    this.nodes.set(node.id, { value: node, expires: this.now() + ttlMs });
  }

  async deregisterNode(id: string) {
    this.nodes.delete(id);
  }

  async listNodes() {
    const now = this.now();
    return [...this.nodes.values()].filter((n) => n.expires > now).map((n) => n.value);
  }

  async getLease(room: string) {
    return this.live(this.leases, room);
  }

  async acquireLease(room: string, nodeId: string, ttlMs: number, replaceOwner?: string) {
    const owner = this.live(this.leases, room);
    if (owner && owner !== replaceOwner) return owner;
    this.leases.set(room, { value: nodeId, expires: this.now() + ttlMs });
    return nodeId;
  }

  async renewLease(room: string, nodeId: string, ttlMs: number) {
    const owner = this.live(this.leases, room);
    if (!owner || owner === nodeId) this.leases.set(room, { value: nodeId, expires: this.now() + ttlMs });
    return owner ?? nodeId;
  }

  async getRoomTier(room: string) {
    return this.live(this.tiers, room);
  }

  async setRoomTier(room: string, tier: Tier, ttlMs: number) {
    this.tiers.set(room, { value: tier, expires: this.now() + ttlMs });
  }

  private live<T>(map: Map<string, Expiring<T>>, key: string): T | undefined {
    const entry = map.get(key);
    return entry && entry.expires > this.now() ? entry.value : undefined;
  }
}
