import {
  JoinResponse,
  PROTOCOL_VERSION,
  parseServerMessage,
  videoTierFor,
  type DataMessage,
  type ServerMessage,
} from '@chillcall/protocol';
import { backoffDelay } from './backoff';
import { PeerLink, type SignalPayload } from './peer-link';
import {
  JoinError,
  RoomFullError,
  UpgradeRequiredError,
  type RoomEvent,
  type RoomTransport,
} from './transport';

export interface MeshOptions {
  /** Base URL of the beacon, for example `https://chill.example.com`. */
  beaconUrl: string;
  clientVersion?: string;
}

type Welcome = Extract<ServerMessage, { type: 'welcome' }>;

const JOIN_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 25_000;
const OUTBOX_LIMIT = 200;

/**
 * Full-mesh WebRTC. The beacon says which signaling node owns the room; the node relays offers, answers
 * and ICE candidates; media and data then flow directly between peers, one connection per pair.
 */
export class MeshTransport implements RoomTransport {
  private handlers = new Set<(event: RoomEvent) => void>();
  private links = new Map<string, PeerLink>();
  private names = new Map<string, string>();
  private lastSent = new Map<string, DataMessage>();
  private outbox: string[] = [];

  private socket?: WebSocket;
  private session?: JoinResponse;
  private pingTimer?: ReturnType<typeof setInterval>;
  private pendingJoin?: { resolve(welcome: Welcome): void; reject(error: Error): void };
  private closing = false;

  private room = '';
  private name = '';
  private local?: MediaStream;
  private resumeToken?: string;

  constructor(private opts: MeshOptions) {}

  async join(room: string, name: string, local: MediaStream): Promise<void> {
    this.room = room;
    this.name = name;
    this.local = local;
    this.closing = false;

    const welcome = await this.connect();
    this.applyWelcome(welcome);
  }

  leave(): void {
    this.closing = true;
    clearInterval(this.pingTimer);
    this.socket?.close(1000);
    this.socket = undefined;
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.names.clear();
    this.outbox = [];
  }

  send(message: DataMessage): void {
    this.lastSent.set(message.kind, message);
    for (const link of this.links.values()) link.send(message);
  }

  async replaceLocalStream(local: MediaStream): Promise<void> {
    this.local = local;
    for (const link of this.links.values()) await link.replaceLocalStream(local);
  }

  on(handler: (event: RoomEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: RoomEvent) {
    for (const handler of this.handlers) handler(event);
  }

  // --- signaling connection -------------------------------------------------

  private async requestSession(): Promise<JoinResponse> {
    let res: Response;
    try {
      res = await fetch(new URL('/v1/rooms/join', this.opts.beaconUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          room: this.room,
          clientVersion: this.opts.clientVersion ?? '0.0.0',
          protocol: PROTOCOL_VERSION,
          resume: this.resumeToken,
        }),
      });
    } catch {
      throw new JoinError('Could not reach the server.');
    }
    if (res.status === 426) throw new UpgradeRequiredError();
    if (!res.ok) throw new JoinError(res.status === 503 ? 'No server is available right now.' : 'Could not join the room.');
    const session = JoinResponse.parse(await res.json());
    this.resumeToken = session.resumeToken;
    return session;
  }

  /** Opens the signaling socket and resolves once the node has admitted us. */
  private async connect(): Promise<Welcome> {
    const session = await this.requestSession();
    this.session = session;

    const socket = new WebSocket(session.signalingUrl);
    this.socket = socket;

    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const timer = setTimeout(() => reject(new JoinError('The server took too long to respond.')), JOIN_TIMEOUT_MS);
      this.pendingJoin = {
        resolve: (w) => (clearTimeout(timer), resolve(w)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
      socket.onopen = () =>
        socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'join', token: session.joinToken, name: this.name }));
      socket.onmessage = (event) => this.onSocketMessage(event.data);
      socket.onclose = () => {
        this.pendingJoin?.reject(new JoinError('The server closed the connection.'));
        this.pendingJoin = undefined;
        if (this.socket === socket) this.onSocketClosed();
      };
    });

    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.sendRaw({ v: PROTOCOL_VERSION, type: 'ping' }), PING_INTERVAL_MS);
    return welcome;
  }

  private onSocketMessage(raw: unknown) {
    const parsed = parseServerMessage(String(raw));
    if (!parsed.ok) return;
    const msg = parsed.message;

    switch (msg.type) {
      case 'welcome':
        this.pendingJoin?.resolve(msg);
        this.pendingJoin = undefined;
        break;
      case 'error':
        if (this.pendingJoin) {
          const error =
            msg.code === 'room-full' ? new RoomFullError() : new JoinError(`Could not join the room (${msg.code}).`);
          this.pendingJoin.reject(error);
          this.pendingJoin = undefined;
        }
        break;
      case 'peer-joined':
        this.names.set(msg.peer.id, msg.peer.name);
        this.emit({ type: 'participant-joined', participant: msg.peer });
        break;
      case 'peer-left':
        this.dropPeer(msg.id);
        break;
      case 'signal':
        void this.linkFor(msg.from, false)?.handleSignal(msg.payload as SignalPayload);
        break;
      case 'pong':
        break;
    }
  }

  private onSocketClosed() {
    if (this.closing) return;
    clearInterval(this.pingTimer);
    this.emit({ type: 'connection', state: 'reconnecting' });
    void this.reconnect();
  }

  /** Rejoins through the beacon with jittered backoff; established calls keep running meanwhile. */
  private async reconnect() {
    for (let attempt = 0; !this.closing; attempt++) {
      await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
      if (this.closing) return;
      try {
        const welcome = await this.connect();
        this.applyWelcome(welcome);
        this.emit({ type: 'connection', state: 'connected' });
        this.flushOutbox();
        return;
      } catch (err) {
        if (err instanceof RoomFullError || err instanceof UpgradeRequiredError) {
          this.emit({ type: 'connection', state: 'closed', reason: err.message });
          return;
        }
      }
    }
  }

  private sendRaw(message: Record<string, unknown> & { type: string }) {
    const frame = JSON.stringify(message);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(frame);
    else if (message.type === 'signal' && this.outbox.length < OUTBOX_LIMIT) this.outbox.push(frame);
  }

  private flushOutbox() {
    const pending = this.outbox;
    this.outbox = [];
    for (const frame of pending) this.socket?.send(frame);
  }

  // --- peers ----------------------------------------------------------------

  private applyWelcome(welcome: Welcome) {
    const present = new Set(welcome.peers.map((p) => p.id));

    // If the node did not recognize us we are a new member to everyone, so start every connection afresh.
    if (!welcome.resumed) for (const id of [...this.links.keys()]) this.closeLink(id);
    for (const id of [...this.names.keys()]) if (!present.has(id)) this.dropPeer(id);

    for (const peer of welcome.peers) {
      if (!this.names.has(peer.id)) {
        this.names.set(peer.id, peer.name);
        this.emit({ type: 'participant-joined', participant: peer });
      }
      if (!this.links.has(peer.id)) this.linkFor(peer.id, true);
    }
  }

  private linkFor(id: string, initiator: boolean): PeerLink | undefined {
    const existing = this.links.get(id);
    if (existing) return existing;
    if (!this.session || !this.local) return undefined;

    const link: PeerLink = new PeerLink(
      id,
      this.session.peerId,
      { iceServers: this.session.iceServers },
      this.local,
      {
        signal: (payload) => this.sendRaw({ v: PROTOCOL_VERSION, type: 'signal', to: id, payload }),
        stream: (stream) => this.emit({ type: 'stream', id, stream }),
        message: (data) => this.emit({ type: 'message', id, data }),
        state: (state) => {
          this.emit({ type: 'peer-state', id, state });
          if (state === 'connected') void this.applyVideoTiers();
        },
        // Replay the latest state (mute, camera) to a peer whose channel just opened.
        channelOpen: () => {
          for (const message of this.lastSent.values()) link.send(message);
        },
      },
      initiator,
    );
    this.links.set(id, link);
    return link;
  }

  private closeLink(id: string) {
    this.links.get(id)?.close();
    this.links.delete(id);
  }

  private dropPeer(id: string) {
    this.closeLink(id);
    if (this.names.delete(id)) this.emit({ type: 'participant-left', id });
    void this.applyVideoTiers();
  }

  /** Lower per-sender video quality as the room grows, since every peer gets its own encode. */
  private async applyVideoTiers() {
    const tier = videoTierFor(this.names.size + 1);
    for (const link of this.links.values()) if (link.connected) await link.applyVideoTier(tier);
  }
}
