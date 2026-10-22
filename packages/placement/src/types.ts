import type { Tier } from '@chillcall/protocol';

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
}

export class NoNodesError extends Error {
  constructor() {
    super('No signaling node is available.');
  }
}

export const LEASE_TTL_MS = 60_000;
export const NODE_TTL_MS = 15_000;
