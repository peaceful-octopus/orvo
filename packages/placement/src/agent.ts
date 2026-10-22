import { LEASE_TTL_MS, NODE_TTL_MS, type NodeInfo, type PlacementStore } from './types';

export interface NodeAgentOptions {
  heartbeatMs?: number;
  nodeTtlMs?: number;
  leaseRenewMs?: number;
  leaseTtlMs?: number;
  onError?: (error: unknown) => void;
}

/**
 * Runs on a signaling node: announces it to the store on a heartbeat and keeps the leases of the
 * rooms it hosts alive, so the beacon always routes a room to the node that actually has it.
 */
export class NodeAgent {
  private heartbeat?: ReturnType<typeof setInterval>;
  private renewal?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    private store: PlacementStore,
    private base: Omit<NodeInfo, 'draining' | 'connections'>,
    private status: () => { rooms: string[]; connections: number },
    private opts: NodeAgentOptions = {},
  ) {}

  async start() {
    await this.beat();
    this.heartbeat = setInterval(() => void this.beat(), this.opts.heartbeatMs ?? 5_000);
    this.renewal = setInterval(() => void this.renewLeases(), this.opts.leaseRenewMs ?? 20_000);
    this.heartbeat.unref();
    this.renewal.unref();
  }

  /** Marks the node as draining so the beacon stops placing new rooms on it. */
  async drain() {
    this.draining = true;
    await this.beat();
  }

  /** Stops heartbeating without deregistering, which is what a crashed process looks like to the store. */
  halt() {
    clearInterval(this.heartbeat);
    clearInterval(this.renewal);
  }

  async stop() {
    clearInterval(this.heartbeat);
    clearInterval(this.renewal);
    try {
      await this.store.deregisterNode(this.base.id);
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  private async beat() {
    try {
      const { connections } = this.status();
      await this.store.registerNode(
        { ...this.base, draining: this.draining, connections },
        this.opts.nodeTtlMs ?? NODE_TTL_MS,
      );
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  private async renewLeases() {
    for (const room of this.status().rooms) {
      try {
        const owner = await this.store.renewLease(room, this.base.id, this.opts.leaseTtlMs ?? LEASE_TTL_MS);
        if (owner !== this.base.id) this.opts.onError?.(new Error(`room ${room} is leased to ${owner}, not this node`));
      } catch (err) {
        this.opts.onError?.(err);
      }
    }
  }
}
