import { createHash } from 'node:crypto';
import { LEASE_TTL_MS, NoNodesError, type NodeInfo, type PlacementStore } from './types';

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
 * Finds the node that owns `room`. A lease on a live node wins, so adding or removing nodes never
 * splits a running room; only rooms without a live owner are placed by hashing, and the lease is
 * taken over from a dead owner so every beacon agrees afterwards.
 */
export async function placeRoom(store: PlacementStore, room: string): Promise<NodeInfo> {
  const nodes = await store.listNodes();
  const owner = await store.getLease(room);
  const current = owner ? nodes.find((n) => n.id === owner) : undefined;
  if (current) {
    await store.renewLease(room, current.id, LEASE_TTL_MS);
    return current;
  }

  const pick = rendezvousPick(
    room,
    nodes.filter((n) => !n.draining),
  );
  if (!pick) throw new NoNodesError();
  const winner = await store.acquireLease(room, pick.id, LEASE_TTL_MS, owner);
  return nodes.find((n) => n.id === winner && !n.draining) ?? pick;
}
