import type { RoomRecord, Tier } from '@orvo/protocol';

export interface NodeInfo {
  id: string;
  /** Public WebSocket URL; when absent the beacon derives it from the request (single-container mode). */
  url?: string;
  region: string;
  weight: number;
  draining: boolean;
  connections?: number;
}

/** Where live nodes, room leases and room tiers are kept: memory for one process, Redis for a fleet. */
export interface PlacementStore {
  /** Announces a node as alive for `ttlMs`; nodes call this on a heartbeat. */
  registerNode(node: NodeInfo, ttlMs: number): Promise<void>;
  deregisterNode(id: string): Promise<void>;
  /** Nodes whose registration has not expired. */
  listNodes(): Promise<NodeInfo[]>;

  getLease(room: string): Promise<string | undefined>;
  /**
   * Takes the lease if it is free and returns the owner either way. When `replaceOwner` names the
   * current owner (a node known to be gone) the lease is taken over from it atomically.
   */
  acquireLease(room: string, nodeId: string, ttlMs: number, replaceOwner?: string): Promise<string>;
  /** Extends the lease if `nodeId` owns it, or takes it if it is free. Returns the owner. */
  renewLease(room: string, nodeId: string, ttlMs: number): Promise<string>;

  /** Rooms with a paid entitlement keep it for everyone in the room, because a relay helps whole pairs. */
  getRoomTier(room: string): Promise<Tier | undefined>;
  setRoomTier(room: string, tier: Tier, ttlMs: number): Promise<void>;

  /** The room's owner and access rules, if it exists. Rooms are ephemeral: the record expires when the room goes quiet. */
  getRoom(room: string): Promise<RoomRecord | undefined>;
  /** Creates the room unless it exists, and returns the record in force either way (so two creators cannot both win). */
  createRoom(room: string, record: RoomRecord, ttlMs: number): Promise<RoomRecord>;
  /** Keeps a room's record alive while people keep joining. */
  touchRoom(room: string, ttlMs: number): Promise<void>;
  /** Replaces the record of an existing room; returns false when the room has expired. */
  updateRoom(room: string, record: RoomRecord, ttlMs: number): Promise<boolean>;

  /**
   * People the room's owner removed, by peer id and by account. Written by the signaling node that removed them and read
   * by the beacon, which then keeps them out wherever the room runs next, even after the node or the room is gone.
   */
  getBans(room: string): Promise<RoomBans>;
  addBan(room: string, ban: { peerId: string; acct?: string }, ttlMs: number): Promise<void>;
  /**
   * Who a signaling node has admitted to the room, written by the node. A locked room readmits only these, so "was already
   * in the room" means a node let them in, and not merely that the beacon once handed them a token.
   */
  addMember(room: string, peerId: string, ttlMs: number): Promise<void>;
  isMember(room: string, peerId: string): Promise<boolean>;
}

export interface RoomBans {
  peers: string[];
  accts: string[];
}

/** What a node needs of the store to make removals and admissions last. */
export type RoomAccessWriter = Pick<PlacementStore, 'addBan' | 'addMember'>;

/** The shared store cannot be reached and what was asked is not something this beacon remembers, so it cannot be answered safely. */
export class StoreUnavailableError extends Error {
  constructor() {
    super('The placement store is unreachable.');
  }
}

export class NoNodesError extends Error {
  constructor() {
    super('No signaling node is available.');
  }
}

/** The store holds as many rooms as it is willing to, so it will not make another until some expire. */
export class StoreFullError extends Error {
  constructor() {
    super('The placement store is full.');
  }
}

export const LEASE_TTL_MS = 60_000;
/** A node is considered gone this long after its last heartbeat; how fast rooms move after a crash. */
export const NODE_TTL_MS = 6_000;
export const NODE_HEARTBEAT_MS = 2_000;
