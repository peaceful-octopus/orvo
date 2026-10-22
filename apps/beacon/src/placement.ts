import { createHash } from 'node:crypto';

export interface NodeInfo {
  id: string;
  /** Public WebSocket URL; when absent the beacon derives it from the request (single-container mode). */
  url?: string;
  region: string;
  weight: number;
  draining: boolean;
}

/** Where live nodes and room leases are kept: memory for one process, Redis for a fleet. */
export interface PlacementStore {
  listNodes(): Promise<NodeInfo[]>;
  getLease(room: string): Promise<string | undefined>;
  /** Takes the lease if it is free or expired, and returns the owner either way. */
  acquireLease(room: string, nodeId: string, ttlMs: number): Promise<string>;
  /** Extends the lease if `nodeId` still owns it. */
  renewLease(room: string, nodeId: string, ttlMs: number): Promise<void>;
}

export class NoNodesError extends Error {
  constructor() {
    super('No signaling node is available.');
  }
}

export const LEASE_TTL_MS = 60_000;

/** Highest-random-weight hashing: each room independently picks the node with the best score. */
export function rendezvousPick(room: string, nodes: NodeInfo[]): NodeInfo | undefined {
  let best: NodeInfo | undefined;
  let bestScore = -Infinity;
  for (const node of nodes) {
    const digest = createHash('sha256').update(`${room}\0${node.id}`).digest();
    const u = (digest.readUIntBE(0, 6) + 1) / 2 ** 48; // (0, 1]
    const score = -node.weight / Math.log(u);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Finds the node that owns `room`. An existing lease wins, so adding or removing nodes never splits a
 * running room; only rooms without a live lease are placed by hashing.
 */
export async function placeRoom(store: PlacementStore, room: string): Promise<NodeInfo> {
  const nodes = await store.listNodes();
  const owner = await store.getLease(room);
  const current = owner ? nodes.find((n) => n.id === owner) : undefined;
  if (current) {
    await store.renewLease(room, current.id, LEASE_TTL_MS);
    return current;
  }

  const candidates = nodes.filter((n) => !n.draining);
  const pick = rendezvousPick(room, candidates);
  if (!pick) throw new NoNodesError();
  const winner = await store.acquireLease(room, pick.id, LEASE_TTL_MS);
  return nodes.find((n) => n.id === winner) ?? pick;
}

export class MemoryPlacementStore implements PlacementStore {
  private leases = new Map<string, { nodeId: string; expires: number }>();

  constructor(
    private nodes: NodeInfo[],
    private now: () => number = Date.now,
  ) {}

  setNodes(nodes: NodeInfo[]) {
    this.nodes = nodes;
  }

  async listNodes() {
    return this.nodes;
  }

  async getLease(room: string) {
    const lease = this.leases.get(room);
    if (!lease || lease.expires <= this.now()) return undefined;
    return lease.nodeId;
  }

  async acquireLease(room: string, nodeId: string, ttlMs: number) {
    const existing = await this.getLease(room);
    if (existing) return existing;
    this.leases.set(room, { nodeId, expires: this.now() + ttlMs });
    return nodeId;
  }

  async renewLease(room: string, nodeId: string, ttlMs: number) {
    const lease = this.leases.get(room);
    if (lease?.nodeId === nodeId) lease.expires = this.now() + ttlMs;
  }
}
