import {
  JoinResponse,
  PROTOCOL_VERSION,
  parseServerMessage,
  DEFAULT_RELAY_VIDEO_TIER,
  videoTierFor,
  type TelemetryEvent,
  type VideoTier,
  type VideoTierRule,
  type DataMessage,
  type ServerMessage,
} from '@orvo/protocol';
import { requestJoin } from './beacon-session';
import { backoffDelay } from './backoff';
import { PeerLink, type SignalPayload } from './peer-link';
import { sendPolicy, type Route } from './route';
import {
  BeaconUnavailableError,
  InvalidTokenError,
  JoinError,
  KickedError,
  LoginRequiredError,
  RoomFullError,
  RoomLockedError,
  UpgradeRequiredError,
  type RoomEvent,
  type RoomTransport,
} from './transport';

export interface MeshOptions {
  /** Beacon base URLs in preference order, for example `['https://orvo.example.com']`; later ones are fallbacks. */
  beaconUrls: string[];
  clientVersion?: string;
  /** Video quality by room size; defaults to the built-in tiers until a config supplies its own. */
  videoTiers?: VideoTierRule[];
  /** Video limits for connections that go through a relay. */
  relayVideoTier?: VideoTier;
  /** `relay` makes every connection use a relay or fail; for testing that a room has (or lacks) one. */
  iceTransportPolicy?: RTCIceTransportPolicy;
  /** Supplies the signed-in person's ID token for each request to the beacon, refreshed if needed; guests return undefined. */
  getAuthToken?: () => Promise<string | undefined>;
  /** Receives anonymous connection statistics (see `TelemetryClient`); omitted when the user opted out. */
  telemetry?: (event: TelemetryEvent) => void;
}

type Welcome = Extract<ServerMessage, { type: 'welcome' }>;

const JOIN_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 25_000;
const OUTBOX_LIMIT = 200;
const NODE_RETRY_CAP_MS = 4_000;
const BEACON_RETRY_CAP_MS = 30_000;

/**
 * Full-mesh WebRTC. The beacon says which signaling node owns the room; the node relays offers, answers
 * and ICE candidates; media and data then flow directly between peers, one connection per pair.
 */
export class MeshTransport implements RoomTransport {
  private handlers = new Set<(event: RoomEvent) => void>();
  private links = new Map<string, PeerLink>();
  private names = new Map<string, string>();
  private routes = new Map<string, Route>();
  private pausedVideo = new Set<string>();
  private connectStarted = new Map<string, number>();
  private reportedPeers = new Set<string>();
  private lastSent = new Map<string, DataMessage>();
  private screen?: MediaStream;
  private outbox: string[] = [];

  private socket?: WebSocket;
  private session?: JoinResponse;
  private pingTimer?: ReturnType<typeof setInterval>;
  private pendingJoin?: { resolve(welcome: Welcome): void; reject(error: Error): void };
  private closing = false;
  private reconnecting = false;

  private room = '';
  private name = '';
  private local?: MediaStream;
  private resumeToken?: string;

  constructor(private opts: MeshOptions) {}

  /** The room's access rules as the server reported them when we joined, and whether we own the room. */
  get roomAccess(): { signedInOnly: boolean; owner: boolean; locked: boolean } | undefined {
    return this.session?.room;
  }

  /** Owner only: removes someone from the room and keeps them out. The server refuses anyone else. */
  kick(peerId: string): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'kick', peerId });
  }

  async join(room: string, name: string, local: MediaStream): Promise<void> {
    this.room = room;
    this.name = name;
    this.local = local;
    this.closing = false;

    const started = Date.now();
    try {
      const welcome = await this.connect();
      this.applyWelcome(welcome);
      this.opts.telemetry?.({ type: 'join', result: 'ok', ms: Date.now() - started });
    } catch (err) {
      const result =
        err instanceof RoomFullError ? 'room-full' : err instanceof UpgradeRequiredError ? 'upgrade-required' : err instanceof JoinError ? 'unreachable' : 'error';
      this.opts.telemetry?.({ type: 'join', result, ms: Date.now() - started });
      throw err;
    }
  }

  leave(): void {
    this.closing = true;
    clearInterval(this.pingTimer);
    this.socket?.close(1000);
    this.socket = undefined;
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.names.clear();
    this.routes.clear();
    this.pausedVideo.clear();
    this.connectStarted.clear();
    this.reportedPeers.clear();
    this.outbox = [];
  }

  send(message: DataMessage): void {
    this.lastSent.set(message.kind, message);
    for (const [id, link] of this.links) {
      // A peer we send no video to keeps seeing our camera as off, whatever we toggle.
      link.send(message.kind === 'state' && this.pausedVideo.has(id) ? { ...message, video: false } : message);
    }
  }

  /** Shares a screen with everyone in the room (and with people who join later), or stops sharing with undefined. */
  setScreenStream(screen: MediaStream | undefined): void {
    this.screen = screen;
    for (const link of this.links.values()) link.setScreen(screen);
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
    const session = await requestJoin(this.opts.beaconUrls, {
      room: this.room,
      clientVersion: this.opts.clientVersion ?? '0.0.0',
      resume: this.resumeToken,
      authToken: await this.opts.getAuthToken?.(),
    });
    this.resumeToken = session.resumeToken;
    return session;
  }

  /** Opens the signaling socket and resolves once the node has admitted us. */
  private async connect(): Promise<Welcome> {
    const session = await this.requestSession();
    this.session = session;

    const socket = new WebSocket(session.signalingUrl);
    this.socket = socket;

    // Only a connection that was admitted counts as lost when it closes. An attempt that never got a welcome has
    // already failed through the join promise, and treating its close as a new loss would start a second
    // reconnect loop for every failed attempt.
    let established = false;
    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const timer = setTimeout(() => reject(new JoinError('The server took too long to respond.')), JOIN_TIMEOUT_MS);
      this.pendingJoin = {
        resolve: (w) => (clearTimeout(timer), (established = true), resolve(w)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
      socket.onopen = () =>
        socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'join', token: session.joinToken, name: this.name }));
      socket.onmessage = (event) => this.onSocketMessage(event.data);
      socket.onclose = () => {
        this.pendingJoin?.reject(new JoinError('The server closed the connection.'));
        this.pendingJoin = undefined;
        if (this.socket === socket && established) this.onSocketClosed();
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
            msg.code === 'room-full'
              ? new RoomFullError()
              : msg.code === 'kicked'
                ? new KickedError()
                : new JoinError(`Could not join the room (${msg.code}).`);
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
      case 'kicked':
        this.emit({ type: 'kicked' });
        this.leave();
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

  /**
   * Rejoins through the beacon with jittered backoff; established calls keep running meanwhile. Only one loop runs
   * at a time. A node that cannot be reached is retried quickly (the beacon will point elsewhere once its
   * registration lapses); an unreachable beacon backs off longer, so a recovering beacon is not flooded.
   */
  private async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      let capMs = NODE_RETRY_CAP_MS;
      for (let attempt = 0; !this.closing; attempt++) {
        await new Promise((r) => setTimeout(r, backoffDelay(attempt, Math.random, 500, capMs)));
        if (this.closing) return;
        try {
          const welcome = await this.connect();
          this.applyWelcome(welcome);
          this.opts.telemetry?.({ type: 'reconnect', ok: true, attempts: attempt + 1 });
          this.emit({ type: 'connection', state: 'connected' });
          this.flushOutbox();
          return;
        } catch (err) {
          if (
            err instanceof RoomFullError ||
            err instanceof UpgradeRequiredError ||
            err instanceof LoginRequiredError ||
            err instanceof InvalidTokenError ||
            err instanceof RoomLockedError ||
            err instanceof KickedError
          ) {
            this.opts.telemetry?.({ type: 'reconnect', ok: false, attempts: attempt + 1 });
            this.emit({ type: 'connection', state: 'closed', reason: err.message });
            return;
          }
          capMs = err instanceof BeaconUnavailableError ? BEACON_RETRY_CAP_MS : NODE_RETRY_CAP_MS;
        }
      }
    } finally {
      this.reconnecting = false;
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
      { iceServers: this.session.iceServers, iceTransportPolicy: this.opts.iceTransportPolicy },
      this.local,
      {
        signal: (payload) => this.sendRaw({ v: PROTOCOL_VERSION, type: 'signal', to: id, payload }),
        stream: (stream) => this.emit({ type: 'stream', id, stream }),
        message: (data) => this.emit({ type: 'message', id, data }),
        state: (state) => {
          this.emit({ type: 'peer-state', id, state });
          if (state === 'unreachable') this.reportPeer(id, 'unreachable', 'unknown');
          if (state === 'connected') void this.applyVideoTiers();
        },
        route: (route) => {
          this.routes.set(id, route);
          if (route !== 'unknown') this.reportPeer(id, 'connected', route);
          this.emit({ type: 'peer-route', id, route });
          void this.applyVideoTiers();
        },
        // Replay the latest state (mute, camera) to a peer whose channel just opened.
        channelOpen: () => {
          for (const message of this.lastSent.values()) link.send(message);
        },
      },
      initiator,
    );
    link.setScreen(this.screen);
    this.links.set(id, link);
    this.connectStarted.set(id, Date.now());
    return link;
  }

  private closeLink(id: string) {
    this.links.get(id)?.close();
    this.links.delete(id);
    this.routes.delete(id);
    this.pausedVideo.delete(id);
    this.connectStarted.delete(id);
    this.reportedPeers.delete(id);
  }

  /** Reports how a peer connection settled, once per connection. */
  private reportPeer(id: string, result: 'connected' | 'unreachable', route: Route) {
    if (this.reportedPeers.has(id)) return;
    this.reportedPeers.add(id);
    const started = this.connectStarted.get(id) ?? Date.now();
    this.opts.telemetry?.({ type: 'peer', result, route, ms: Date.now() - started });
  }

  private dropPeer(id: string) {
    this.closeLink(id);
    if (this.names.delete(id)) this.emit({ type: 'participant-left', id });
    void this.applyVideoTiers();
  }

  /**
   * Sets what we send each peer: lower quality as the room grows, since every peer gets its own encode, and
   * lower again on relayed paths. Where video cannot be sent at all, that peer is told our camera is off.
   */
  private async applyVideoTiers() {
    const normal = videoTierFor(this.names.size + 1, this.opts.videoTiers);
    const relayed = this.opts.relayVideoTier ?? DEFAULT_RELAY_VIDEO_TIER;
    const roomTier = this.session?.tier ?? 'free';

    for (const [id, link] of this.links) {
      if (!link.connected) continue;
      const policy = sendPolicy(this.routes.get(id) ?? 'unknown', roomTier, normal, relayed);
      await link.applySendPolicy(policy);
      this.announceVideoTo(id, link, policy.video);
    }
  }

  /** Tells a peer whose path carries no video from us that our camera appears off, and restores it later. */
  private announceVideoTo(id: string, link: PeerLink, sending: boolean) {
    const wasPaused = this.pausedVideo.has(id);
    if (!sending && !wasPaused) {
      this.pausedVideo.add(id);
      link.send({ kind: 'state', audio: this.lastAudio(), video: false });
    } else if (sending && wasPaused) {
      this.pausedVideo.delete(id);
      const last = this.lastSent.get('state');
      if (last) link.send(last);
    }
  }

  private lastAudio(): boolean {
    const last = this.lastSent.get('state');
    return last?.kind === 'state' ? last.audio : true;
  }
}
