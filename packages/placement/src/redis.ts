import { RoomRecord, Tier } from '@orvo/protocol';
import type { Redis } from 'ioredis';
import type { NodeInfo, PlacementStore } from './types';

// Replace the lease only if it still names the expected (dead) owner.
const TAKE_OVER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return ARGV[2]
end
return redis.call('GET', KEYS[1])
`;

// Extend the lease if we own it, take it if it is free, otherwise report the owner.
const RENEW = `
local owner = redis.call('GET', KEYS[1])
if not owner then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return ARGV[1]
end
if owner == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return owner
`;

/** Shared store for beacon and signaling fleets. Keys carry TTLs, so a crashed node simply expires. */
export class RedisPlacementStore implements PlacementStore {
  constructor(
    private redis: Redis,
    private prefix = 'orvo:',
  ) {}

  private key = (kind: string, id: string) => `${this.prefix}${kind}:${id}`;
  private nodeIndex = () => `${this.prefix}nodes`;

  async registerNode(node: NodeInfo, ttlMs: number) {
    await this.redis.set(this.key('node', node.id), JSON.stringify(node), 'PX', ttlMs);
    await this.redis.sadd(this.nodeIndex(), node.id);
  }

  async deregisterNode(id: string) {
    await this.redis.del(this.key('node', id));
    await this.redis.srem(this.nodeIndex(), id);
  }

  async listNodes() {
    const ids = await this.redis.smembers(this.nodeIndex());
    if (ids.length === 0) return [];
    const values = await this.redis.mget(ids.map((id) => this.key('node', id)));
    const nodes: NodeInfo[] = [];
    const expired: string[] = [];
    values.forEach((value, i) => {
      if (value) nodes.push(JSON.parse(value) as NodeInfo);
      else expired.push(ids[i]!);
    });
    if (expired.length) await this.redis.srem(this.nodeIndex(), ...expired);
    return nodes;
  }

  async getLease(room: string) {
    return (await this.redis.get(this.key('lease', room))) ?? undefined;
  }

  async acquireLease(room: string, nodeId: string, ttlMs: number, replaceOwner?: string) {
    const key = this.key('lease', room);
    if ((await this.redis.set(key, nodeId, 'PX', ttlMs, 'NX')) === 'OK') return nodeId;
    if (replaceOwner) {
      const owner = await this.redis.eval(TAKE_OVER, 1, key, replaceOwner, nodeId, ttlMs);
      if (owner) return String(owner);
    }
    return (await this.redis.get(key)) ?? nodeId;
  }

  async renewLease(room: string, nodeId: string, ttlMs: number) {
    return String(await this.redis.eval(RENEW, 1, this.key('lease', room), nodeId, ttlMs));
  }

  async getRoomTier(room: string) {
    const parsed = Tier.safeParse(await this.redis.get(this.key('tier', room)));
    return parsed.success ? parsed.data : undefined;
  }

  async setRoomTier(room: string, tier: string, ttlMs: number) {
    await this.redis.set(this.key('tier', room), tier, 'PX', ttlMs);
  }

  async getRoom(room: string) {
    const raw = await this.redis.get(this.key('room', room));
    if (!raw) return undefined;
    try {
      const parsed = RoomRecord.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async createRoom(room: string, record: RoomRecord, ttlMs: number) {
    // NX: when two people create the same room at once, one record wins and both read it back.
    await this.redis.set(this.key('room', room), JSON.stringify(record), 'PX', ttlMs, 'NX');
    return (await this.getRoom(room)) ?? record;
  }

  async touchRoom(room: string, ttlMs: number) {
    await this.redis.pexpire(this.key('room', room), ttlMs);
  }

  async updateRoom(room: string, record: RoomRecord, ttlMs: number) {
    return (await this.redis.set(this.key('room', room), JSON.stringify(record), 'PX', ttlMs, 'XX')) === 'OK';
  }
}
