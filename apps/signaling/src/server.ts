import {
  MAX_FRAME_BYTES,
  MAX_ROOM_SIZE,
  NonceCache,
  encodeServerMessage,
  parseClientMessage,
  roomStatus,
  verifyJoinToken,
  type ErrorCode,
  type KeyRing,
  type ServerMessageBody,
} from '@chillcall/protocol';
import type http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { Metrics } from './metrics';

export interface SignalingOptions {
  nodeId: string;
  keys: KeyRing;
  maxRoomSize?: number;
  /** How long a dropped member keeps its slot so a reconnect does not disturb the other peers. */
  resumeGraceMs?: number;
  joinTimeoutMs?: number;
  heartbeatMs?: number;
  /** Token bucket per connection: `burst` messages, refilled at `perSecond`. */
  rate?: { burst: number; perSecond: number };
  now?: () => number;
}

interface Conn {
  ws: WebSocket;
  alive: boolean;
  tokens: number;
  lastRefill: number;
  room?: string;
  peerId?: string;
  joinTimer?: NodeJS.Timeout;
}

interface Member {
  peerId: string;
  name: string;
  conn?: Conn;
  leaveTimer?: NodeJS.Timeout;
}

const INTENTIONAL_CLOSE = new Set([1000, 1001]);

/** Owns whole rooms: verifies join tokens, enforces the room cap and relays opaque signals between members. */
export class SignalingServer {
  readonly metrics = new Metrics();
  private rooms = new Map<string, Map<string, Member>>();
  private conns = new Set<Conn>();
  private nonces = new NonceCache();
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private heartbeat?: NodeJS.Timeout;
  private isDraining = false;

  private maxRoomSize: number;
  private resumeGraceMs: number;
  private joinTimeoutMs: number;
  private rate: { burst: number; perSecond: number };
  private now: () => number;

  constructor(private opts: SignalingOptions) {
    this.maxRoomSize = opts.maxRoomSize ?? MAX_ROOM_SIZE;
    this.resumeGraceMs = opts.resumeGraceMs ?? 10_000;
    this.joinTimeoutMs = opts.joinTimeoutMs ?? 10_000;
    this.rate = opts.rate ?? { burst: 400, perSecond: 100 };
    this.now = opts.now ?? Date.now;
    this.wss.on('connection', (ws) => this.onConnection(ws));
    const heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.heartbeat = setInterval(() => this.sweep(), heartbeatMs);
    this.heartbeat.unref();
  }

  /** Handles WebSocket upgrades for `path` on an existing HTTP server. */
  attach(server: http.Server, path = '/ws') {
    server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url ?? '/', 'http://x').pathname !== path) return;
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
  }

  get draining() {
    return this.isDraining;
  }

  /** Stops admitting new members; existing rooms keep working until `close`. */
  drain() {
    this.isDraining = true;
  }

  stats() {
    return { connections: this.conns.size, rooms: this.rooms.size, draining: this.isDraining };
  }

  /** Ids of the rooms this node currently hosts, whose leases it must keep alive. */
  roomIds(): string[] {
    return [...this.rooms.keys()];
  }

  renderMetrics(): string {
    const { connections, rooms } = this.stats();
    return this.metrics.render({
      chillcall_signaling_connections: connections,
      chillcall_signaling_rooms: rooms,
      chillcall_signaling_draining: this.isDraining ? 1 : 0,
    });
  }

  /** Closes all connections with 1012 (service restart) so clients reconnect through the beacon. */
  close() {
    clearInterval(this.heartbeat);
    for (const conn of this.conns) conn.ws.close(1012, 'restart');
    for (const room of this.rooms.values()) for (const m of room.values()) clearTimeout(m.leaveTimer);
    this.wss.close();
  }

  private onConnection(ws: WebSocket) {
    const conn: Conn = { ws, alive: true, tokens: this.rate.burst, lastRefill: this.now() };
    this.conns.add(conn);
    this.metrics.inc('chillcall_signaling_connections_total');
    conn.joinTimer = setTimeout(() => this.reject(conn, 'bad-request', 'join-timeout'), this.joinTimeoutMs);

    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data, isBinary) => this.onMessage(conn, data, isBinary));
    ws.on('close', (code) => this.onClose(conn, code));
    ws.on('error', () => ws.terminate());
  }

  private onMessage(conn: Conn, data: unknown, isBinary: boolean) {
    conn.alive = true;
    if (!this.takeToken(conn)) {
      this.metrics.inc('chillcall_signaling_rate_limited_total');
      return this.reject(conn, 'rate-limited');
    }
    if (isBinary) return this.reject(conn, 'bad-request');

    const parsed = parseClientMessage(String(data));
    if (!parsed.ok) {
      this.metrics.inc('chillcall_signaling_frames_rejected_total');
      return this.reject(conn, parsed.code);
    }
    const msg = parsed.message;

    if (msg.type === 'ping') return this.send(conn, { type: 'pong' });
    if (msg.type === 'join') return conn.peerId ? this.reject(conn, 'bad-request') : this.onJoin(conn, msg.token, msg.name);
    if (!conn.peerId || !conn.room) return this.reject(conn, 'bad-request');

    // signal
    const target = this.rooms.get(conn.room)?.get(msg.to);
    if (!target?.conn) return void this.metrics.inc('chillcall_signaling_signals_dropped_total');
    this.send(target.conn, { type: 'signal', from: conn.peerId, payload: msg.payload });
    this.metrics.inc('chillcall_signaling_signals_relayed_total');
  }

  private onJoin(conn: Conn, token: string, name: string) {
    const result = verifyJoinToken(token, { keys: this.opts.keys, nodeId: this.opts.nodeId, now: this.now() });
    if (!result.ok) return this.joinFailed(conn, result.reason === 'wrong-node' ? 'not-owner' : 'bad-token');
    const { payload } = result;
    if (!this.nonces.checkAndAdd(payload.nonce, payload.exp, this.now())) return this.joinFailed(conn, 'bad-token');
    if (this.isDraining) return this.joinFailed(conn, 'draining');

    let room = this.rooms.get(payload.room);
    if (!room) this.rooms.set(payload.room, (room = new Map()));
    const existing = room.get(payload.peerId);

    if (existing) {
      // Resume: the same peer reconnecting. Other members are not told anything.
      clearTimeout(existing.leaveTimer);
      existing.leaveTimer = undefined;
      existing.conn?.ws.close(4000, 'replaced');
      if (existing.conn) existing.conn.peerId = undefined;
      existing.conn = conn;
      existing.name = name;
      this.metrics.inc('chillcall_signaling_resumes_total');
    } else {
      if (room.size >= this.maxRoomSize) {
        if (room.size === 0) this.rooms.delete(payload.room);
        return this.joinFailed(conn, 'room-full');
      }
      room.set(payload.peerId, { peerId: payload.peerId, name, conn });
    }

    clearTimeout(conn.joinTimer);
    conn.room = payload.room;
    conn.peerId = payload.peerId;
    this.metrics.inc('chillcall_signaling_joins_total');

    const others = [...room.values()].filter((m) => m.peerId !== payload.peerId);
    this.send(conn, {
      type: 'welcome',
      peerId: payload.peerId,
      peers: others.map((m) => ({ id: m.peerId, name: m.name })),
      status: roomStatus(room.size),
      resumed: Boolean(existing),
    });
    if (!existing) {
      for (const m of others) if (m.conn) this.send(m.conn, { type: 'peer-joined', peer: { id: payload.peerId, name } });
    }
  }

  private joinFailed(conn: Conn, code: ErrorCode) {
    this.metrics.inc('chillcall_signaling_join_failures_total', { code });
    this.reject(conn, code);
  }

  private onClose(conn: Conn, code: number) {
    clearTimeout(conn.joinTimer);
    this.conns.delete(conn);
    if (!conn.room || !conn.peerId) return;
    const room = this.rooms.get(conn.room);
    const member = room?.get(conn.peerId);
    if (!room || !member || member.conn !== conn) return;

    member.conn = undefined;
    const leave = () => this.removeMember(conn.room!, member.peerId);
    if (INTENTIONAL_CLOSE.has(code) || this.resumeGraceMs === 0) leave();
    else member.leaveTimer = setTimeout(leave, this.resumeGraceMs);
  }

  private removeMember(roomId: string, peerId: string) {
    const room = this.rooms.get(roomId);
    if (!room?.delete(peerId)) return;
    if (room.size === 0) this.rooms.delete(roomId);
    for (const m of room.values()) if (m.conn) this.send(m.conn, { type: 'peer-left', id: peerId });
  }

  private takeToken(conn: Conn): boolean {
    const now = this.now();
    conn.tokens = Math.min(this.rate.burst, conn.tokens + ((now - conn.lastRefill) / 1000) * this.rate.perSecond);
    conn.lastRefill = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }

  private send(conn: Conn, message: ServerMessageBody) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(encodeServerMessage(message));
  }

  private reject(conn: Conn, code: ErrorCode, reason: string = code) {
    this.send(conn, { type: 'error', code });
    conn.ws.close(1008, reason);
  }

  private sweep() {
    for (const conn of this.conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }
}
