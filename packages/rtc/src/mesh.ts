import Peer, { type DataConnection, type MediaConnection } from 'peerjs';
import { PEER_PATH, peerIdFor } from './ids';
import { videoTierFor } from './limits';
import type { RoomEvent, RoomTransport } from './transport';

export class RoomFullError extends Error {
  constructor() {
    super('This room is full.');
  }
}

type Wire = { t: 'hello'; name: string } | { t: 'msg'; data: unknown };

interface RoomInfo {
  peers: string[];
  status: 'ok' | 'degraded' | 'full';
}

/** Full-mesh WebRTC: one media call and one data connection per remote peer, brokered by peerjs-server. */
export class MeshTransport implements RoomTransport {
  private peer?: Peer;
  private local?: MediaStream;
  private name = '';
  private handlers = new Set<(event: RoomEvent) => void>();
  private calls = new Map<string, MediaConnection>();
  private conns = new Map<string, DataConnection>();
  private known = new Set<string>();

  constructor(private signalingUrl: string) {}

  async join(room: string, name: string, local: MediaStream): Promise<void> {
    this.name = name;
    this.local = local;
    const url = new URL(this.signalingUrl);

    const precheck = await this.fetchRoom(url, room);
    if (precheck.status === 'full') throw new RoomFullError();

    const secure = url.protocol === 'https:';
    const peer = new Peer(peerIdFor(room), {
      host: url.hostname,
      port: Number(url.port || (secure ? 443 : 80)),
      path: PEER_PATH,
      secure,
    });
    this.peer = peer;
    await new Promise<void>((resolve, reject) => {
      peer.once('open', () => resolve());
      peer.once('error', reject);
    });

    peer.on('call', (call) => {
      if (!this.prefersIncoming(call.peer, this.calls)) return call.close();
      call.answer(this.local);
      this.attachCall(call);
    });
    peer.on('connection', (conn) => {
      if (!this.prefersIncoming(conn.peer, this.conns)) return conn.close();
      this.attachConn(conn);
    });

    // Fetch members only after registering, so of two simultaneous joiners at least one sees the other.
    const { peers } = await this.fetchRoom(url, room);
    for (const id of peers) {
      if (id === peer.id) continue;
      if (!this.calls.has(id)) this.attachCall(peer.call(id, local));
      if (!this.conns.has(id)) this.attachConn(peer.connect(id));
    }
  }

  private async fetchRoom(url: URL, room: string): Promise<RoomInfo> {
    const res = await fetch(new URL(`/rooms/${room}`, url));
    if (!res.ok) throw new Error(`Could not reach the signaling server (${res.status}).`);
    return (await res.json()) as RoomInfo;
  }

  /**
   * When both peers dial each other at once, keep the connection initiated by the lower id.
   * Returns whether the incoming connection from `remoteId` should replace what we have.
   */
  private prefersIncoming(remoteId: string, existing: Map<string, { close(): void }>): boolean {
    const mine = existing.get(remoteId);
    if (!mine) return true;
    if (this.peer && this.peer.id < remoteId) return false;
    existing.delete(remoteId); // unregister first so its close handler does not drop the peer
    mine.close();
    return true;
  }

  leave(): void {
    this.peer?.destroy();
    this.peer = undefined;
    this.calls.clear();
    this.conns.clear();
    this.known.clear();
  }

  send(data: unknown): void {
    this.broadcast({ t: 'msg', data });
  }

  async replaceLocalStream(local: MediaStream): Promise<void> {
    this.local = local;
    for (const call of this.calls.values()) {
      for (const sender of call.peerConnection?.getSenders() ?? []) {
        const track = local.getTracks().find((t) => t.kind === sender.track?.kind);
        if (track) await sender.replaceTrack(track);
      }
    }
  }

  on(handler: (event: RoomEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: RoomEvent) {
    for (const handler of this.handlers) handler(event);
  }

  private broadcast(wire: Wire) {
    for (const conn of this.conns.values()) if (conn.open) conn.send(wire);
  }

  private attachCall(call: MediaConnection) {
    this.calls.set(call.peer, call);
    call.on('stream', (stream) => {
      this.emit({ type: 'stream', id: call.peer, stream });
      void this.applyVideoTier();
    });
    call.on('close', () => this.calls.get(call.peer) === call && this.drop(call.peer));
    call.on('error', () => this.calls.get(call.peer) === call && this.drop(call.peer));
  }

  private attachConn(conn: DataConnection) {
    this.conns.set(conn.peer, conn);
    conn.on('open', () => conn.send({ t: 'hello', name: this.name } satisfies Wire));
    conn.on('data', (raw) => {
      const wire = raw as Wire;
      if (wire.t === 'hello') {
        if (this.known.has(conn.peer)) return;
        this.known.add(conn.peer);
        this.emit({ type: 'participant-joined', participant: { id: conn.peer, name: wire.name } });
        void this.applyVideoTier();
      } else if (wire.t === 'msg') {
        this.emit({ type: 'message', id: conn.peer, data: wire.data });
      }
    });
    conn.on('close', () => this.conns.get(conn.peer) === conn && this.drop(conn.peer));
    conn.on('error', () => this.conns.get(conn.peer) === conn && this.drop(conn.peer));
  }

  private drop(id: string) {
    const call = this.calls.get(id);
    const conn = this.conns.get(id);
    this.calls.delete(id);
    this.conns.delete(id);
    call?.close();
    conn?.close();
    if (this.known.delete(id)) {
      this.emit({ type: 'participant-left', id });
      void this.applyVideoTier();
    }
  }

  /** Lower per-sender video quality as the room grows, since every peer gets its own encode. */
  private async applyVideoTier() {
    const tier = videoTierFor(this.known.size + 1);
    for (const call of this.calls.values()) {
      for (const sender of call.peerConnection?.getSenders() ?? []) {
        if (sender.track?.kind !== 'video') continue;
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        for (const encoding of params.encodings) {
          encoding.maxBitrate = tier.maxBitrate;
          encoding.scaleResolutionDownBy = tier.scaleResolutionDownBy;
          encoding.maxFramerate = tier.maxFramerate;
        }
        await sender.setParameters(params).catch(() => {});
      }
    }
  }
}
