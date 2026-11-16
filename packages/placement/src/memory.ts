import type { RoomRecord, Tier } from '@orvo/protocol';
import { StoreFullError, type NodeInfo, type PlacementStore, type RoomBans } from './types';

interface Expiring<T> {
  value: T;
  expires: number;
}

/** Most room records held at once. Records last a day, so unauthenticated joins to made-up names must not pile up without end. */
const DEFAULT_MAX_ROOMS = 50_000;
/** Expired entries are removed (at most) this often, as a side effect of writes. */
const SWEEP_MS = 30_000;

/** In-process store for the all-in-one server, a single beacon, and tests. */
export class MemoryPlacementStore implements PlacementStore {
  private nodes = new Map<string, Expiring<NodeInfo>>();
  private leases = new Map<string, Expiring<string>>();
  private tiers = new Map<string, Expiring<Tier>>();
  private rooms = new Map<string, Expiring<RoomRecord>>();
  private bans = new Map<string, Expiring<{ peers: Set<string>; accts: Set<string> }>>();
  private members = new Map<string, Expiring<true>>();

  private nextSweep = 0;

  constructor(
    initialNodes: NodeInfo[] = [],
    private now: () => number = Date.now,
    private options: { maxRooms?: number } = {},
  ) {
    for (const node of initialNodes) this.nodes.set(node.id, { value: node, expires: Infinity });
  }

  /** Removes everything that has expired. Reads already ignore it; this is what lets the memory go. */
  sweep() {
    const now = this.now();
    for (const map of [this.nodes, this.leases, this.tiers, this.rooms, this.bans, this.members] as Map<string, Expiring<unknown>>[]) {
      for (const [key, entry] of map) if (entry.expires <= now) map.delete(key);
    }
  }

  private sweepSometimes() {
    const now = this.now();
    if (now < this.nextSweep) return;
    this.nextSweep = now + SWEEP_MS;
    this.sweep();
  }

  async registerNode(node: NodeInfo, ttlMs: number) {
    this.sweepSometimes();
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
    this.sweepSometimes();
    const owner = this.live(this.leases, room);
    if (owner && owner !== replaceOwner) return owner;
    this.leases.set(room, { value: nodeId, expires: this.now() + ttlMs });
    return nodeId;
  }

  async renewLease(room: string, nodeId: string, ttlMs: number) {
    this.sweepSometimes();
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
    this.sweepSometimes();
    this.tiers.set(room, { value: tier, expires: this.now() + ttlMs });
  }

  async getRoom(room: string) {
    return this.live(this.rooms, room);
  }

  async createRoom(room: string, record: RoomRecord, ttlMs: number) {
    const existing = this.live(this.rooms, room);
    if (existing) return existing;
    this.sweepSometimes();
    if (this.rooms.size >= (this.options.maxRooms ?? DEFAULT_MAX_ROOMS)) {
      this.sweep();
      if (this.rooms.size >= (this.options.maxRooms ?? DEFAULT_MAX_ROOMS)) throw new StoreFullError();
    }
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

  /** Stores a record read elsewhere, replacing any older copy, so this store can stand in if that source becomes unavailable. */
  setRoom(room: string, record: RoomRecord, ttlMs: number) {
    this.rooms.set(room, { value: record, expires: this.now() + ttlMs });
  }

  async getBans(room: string): Promise<RoomBans> {
    const found = this.live(this.bans, room);
    return { peers: [...(found?.peers ?? [])], accts: [...(found?.accts ?? [])] };
  }

  async addBan(room: string, ban: { peerId: string; acct?: string }, ttlMs: number) {
    const found = this.live(this.bans, room) ?? { peers: new Set<string>(), accts: new Set<string>() };
    found.peers.add(ban.peerId);
    if (ban.acct) found.accts.add(ban.acct);
    this.bans.set(room, { value: found, expires: this.now() + ttlMs });
  }

  async addMember(room: string, peerId: string, ttlMs: number) {
    this.sweepSometimes();
    this.members.set(`${room}\0${peerId}`, { value: true, expires: this.now() + ttlMs });
  }

  async isMember(room: string, peerId: string) {
    return this.live(this.members, `${room}\0${peerId}`) === true;
  }

  private live<T>(map: Map<string, Expiring<T>>, key: string): T | undefined {
    const entry = map.get(key);
    return entry && entry.expires > this.now() ? entry.value : undefined;
  }
}
