import {
  JoinResponse,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
} from '@orvo/protocol';
import { backoffDelay } from '@orvo/rtc';
import WebSocket from 'ws';

/** What a simulated client reports; the runner turns these into statistics. */
export interface SimReporter {
  joinOk(ms: number): void;
  joinFailed(reason: string): void;
  reconnected(ms: number, attempts: number): void;
  signalRtt(ms: number): void;
  signalsSent(count: number): void;
  signalsReceived(count: number): void;
}

export interface SimClientOptions {
  beaconUrl: string;
  room: string;
  name: string;
  reporter: SimReporter;
  /** Signals exchanged per peer pair in each direction: roughly one offer or answer plus its ICE candidates. */
  signalsPerPair?: number;
  /** Test hook: how to learn about reconnect delays. Defaults to the app's jittered backoff. */
  backoff?: (attempt: number) => number;
  joinTimeoutMs?: number;
}

type Welcome = Extract<ServerMessage, { type: 'welcome' }>;

/**
 * A client that speaks the signaling protocol without media: it asks the beacon where to go, joins, and
 * exchanges the burst of offers, answers and candidates a real pair of browsers would, reconnecting with a
 * resume token the way the app does. It exists to load servers, not to test WebRTC.
 */
export class SimClient {
  private socket?: WebSocket;
  private resumeToken?: string;
  private selfId = '';
  private stopped = false;
  private pairs = new Set<string>();
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnecting = false;

  state: 'idle' | 'connected' | 'reconnecting' | 'closed' = 'idle';
  /** How many people were already in the room when this client was last admitted. */
  welcomePeers = 0;
  /** The signaling node this client is currently connected to. */
  nodeUrl = '';

  constructor(private opts: SimClientOptions) {}

  get peerId() {
    return this.selfId;
  }

  /** Joins the room; resolves once admitted, rejects with the reason otherwise. */
  async start(): Promise<void> {
    const started = Date.now();
    try {
      await this.connect();
      this.opts.reporter.joinOk(Date.now() - started);
    } catch (err) {
      this.state = 'closed';
      this.opts.reporter.joinFailed(err instanceof Error ? err.message : 'error');
      throw err;
    }
  }

  stop() {
    this.stopped = true;
    this.state = 'closed';
    clearInterval(this.pingTimer);
    this.socket?.close(1000);
  }

  /** Drops the connection without telling the server, as a network failure would. */
  sever() {
    this.socket?.terminate();
  }

  private async requestSession(): Promise<JoinResponse> {
    let res: Response;
    try {
      res = await fetch(new URL('/v1/rooms/join', this.opts.beaconUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room: this.opts.room, clientVersion: '0.0.0', protocol: PROTOCOL_VERSION, resume: this.resumeToken }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('beacon-unreachable');
    }
    if (!res.ok) throw new Error(`beacon-${res.status}`);
    const session = JoinResponse.parse(await res.json());
    this.resumeToken = session.resumeToken;
    return session;
  }

  private async connect(): Promise<void> {
    const session = await this.requestSession();
    this.selfId = session.peerId;
    this.nodeUrl = session.signalingUrl;

    const socket = new WebSocket(session.signalingUrl, { handshakeTimeout: this.opts.joinTimeoutMs ?? 10_000 });
    this.socket = socket;

    // As in the real transport: a socket that never got a welcome has already failed through this promise.
    let established = false;
    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('welcome-timeout')), this.opts.joinTimeoutMs ?? 10_000);
      const fail = (reason: string) => (clearTimeout(timer), reject(new Error(reason)));
      socket.on('open', () => socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'join', token: session.joinToken, name: this.opts.name })));
      socket.on('error', () => fail('socket-error'));
      socket.on('message', (data) => {
        const parsed = parseServerMessage(String(data));
        if (!parsed.ok) return;
        const msg = parsed.message;
        if (msg.type === 'welcome') {
          clearTimeout(timer);
          established = true;
          resolve(msg);
        } else if (msg.type === 'error' && !established) {
          fail(msg.code);
        } else {
          this.onMessage(msg);
        }
      });
      socket.on('close', () => {
        if (!established) return fail('closed-before-welcome');
        this.onClosed(socket);
      });
    });

    this.state = 'connected';
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25_000);
    this.welcomePeers = welcome.peers.length;
    if (!welcome.resumed) this.pairs.clear();
    for (const peer of welcome.peers) this.initiatePair(peer.id);
  }

  private send(message: { type: string } & Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  }

  private burst(to: string, reply: boolean) {
    const count = this.opts.signalsPerPair ?? 14;
    for (let i = 0; i < count; i++) this.send({ type: 'signal', to, payload: { sim: true, reply, i, t: Date.now() } });
    this.opts.reporter.signalsSent(count);
  }

  private initiatePair(peerId: string) {
    if (this.pairs.has(peerId)) return;
    this.pairs.add(peerId);
    this.burst(peerId, false);
  }

  private onMessage(msg: ServerMessage) {
    if (msg.type === 'peer-left') this.pairs.delete(msg.id);
    if (msg.type !== 'signal') return;
    this.opts.reporter.signalsReceived(1);

    const payload = msg.payload as { reply?: boolean; i?: number; t?: number } | undefined;
    if (payload?.reply && payload.i === 0 && typeof payload.t === 'number') this.opts.reporter.signalRtt(Date.now() - payload.t);
    // The first signal from someone new is an offer: answer it with a burst of our own.
    if (!payload?.reply && !this.pairs.has(msg.from)) {
      this.pairs.add(msg.from);
      this.burst(msg.from, true);
    }
  }

  private onClosed(socket: WebSocket) {
    if (this.socket !== socket || this.stopped) return;
    clearInterval(this.pingTimer);
    this.state = 'reconnecting';
    void this.reconnect();
  }

  private async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      const lost = Date.now();
      let capMs = 4_000;
      for (let attempt = 0; !this.stopped; attempt++) {
        const delay = this.opts.backoff ? this.opts.backoff(attempt) : backoffDelay(attempt, Math.random, 500, capMs);
        await new Promise((r) => setTimeout(r, delay));
        if (this.stopped) return;
        try {
          await this.connect();
          this.opts.reporter.reconnected(Date.now() - lost, attempt + 1);
          return;
        } catch (err) {
          const reason = err instanceof Error ? err.message : '';
          // A full room or an upgrade requirement will not fix itself; anything else is worth retrying.
          if (['room-full', 'upgrade-required', 'bad-token'].includes(reason)) {
            this.state = 'closed';
            this.opts.reporter.joinFailed(reason);
            return;
          }
          capMs = reason.startsWith('beacon-') ? 30_000 : 4_000;
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }
}
