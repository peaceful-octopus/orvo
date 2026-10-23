import type { RoomRecord, Tier } from '@chillcall/protocol';
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
  private rooms = new Map<string, Expiring<RoomRecord>>();

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

  /** Records a lease decided elsewhere, so this store can stand in if that source becomes unavailable. */
  setLease(room: string, nodeId: string, ttlMs: number) {
    this.leases.set(room, { value: nodeId, expires: this.now() + ttlMs });
  }

  async getRoomTier(room: string) {
    return this.live(this.tiers, room);
  }

  async setRoomTier(room: string, tier: Tier, ttlMs: number) {
    this.tiers.set(room, { value: tier, expires: this.now() + ttlMs });
  }

  async getRoom(room: string) {
    return this.live(this.rooms, room);
  }

  async createRoom(room: string, record: RoomRecord, ttlMs: number) {
    const existing = this.live(this.rooms, room);
    if (existing) return existing;
    this.rooms.set(room, { value: record, expires: this.now() + ttlMs });
    return record;
  }

  async touchRoom(room: string, ttlMs: number) {
    const entry = this.rooms.get(room);
    if (entry && entry.expires > this.now()) entry.expires = this.now() + ttlMs;
  }

  async updateRoom(room: string, record: RoomRecord, ttlMs: number) {
    if (!this.live(this.rooms, room)) return false;
    this.rooms.set(room, { value: record, expires: this.now() + ttlMs });
    return true;
  }

  private live<T>(map: Map<string, Expiring<T>>, key: string): T | undefined {
    const entry = map.get(key);
    return entry && entry.expires > this.now() ? entry.value : undefined;
  }
}
