import { encodeDataMessage, parseDataMessage, type DataMessage } from '@chillcall/protocol';
import { routeFromStats, type Route, type SendPolicy, type StatsLike } from './route';
import type { PeerState } from './transport';

export interface SignalPayload {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface PeerLinkHooks {
  signal(payload: SignalPayload): void;
  stream(stream: MediaStream): void;
  message(message: DataMessage): void;
  state(state: PeerState): void;
  route(route: Route): void;
  channelOpen(): void;
}

const CONNECT_TIMEOUT_MS = 25_000;
const DISCONNECT_GRACE_MS = 4_000;
const MAX_ICE_RESTARTS = 2;
const ROUTE_POLL_MS = 10_000;

/**
 * One RTCPeerConnection to one remote peer, carrying media plus a negotiated data channel.
 * Offers and answers follow the "perfect negotiation" pattern, so both sides may start negotiating
 * at once and the lower id (the polite peer) backs off.
 */
export class PeerLink {
  private pc: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private prepared = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private iceRestarts = 0;
  private state: PeerState = 'connecting';
  private connectTimer?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private routeTimer?: ReturnType<typeof setInterval>;
  private currentRoute: Route = 'unknown';
  private policy?: SendPolicy;
  private readonly polite: boolean;
  /** A shared screen travels as extra tracks, apart from the camera's, so they are tracked separately. */
  private screen?: MediaStream;
  private screenSenders: RTCRtpSender[] = [];

  constructor(
    readonly id: string,
    selfId: string,
    config: RTCConfiguration,
    private local: MediaStream,
    private hooks: PeerLinkHooks,
    /** The initiator adds its media immediately; a responder adds it after the remote offer is applied. */
    initiator: boolean,
  ) {
    this.polite = selfId < id;
    this.pc = new RTCPeerConnection(config);
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) hooks.signal({ candidate: candidate.toJSON() });
    };
    this.pc.ontrack = ({ streams, track }) => hooks.stream(streams[0] ?? new MediaStream([track]));
    this.pc.onnegotiationneeded = () => void this.makeOffer();
    this.pc.oniceconnectionstatechange = () => this.onIceState();
    this.connectTimer = setTimeout(() => this.setState('unreachable'), CONNECT_TIMEOUT_MS);
    if (initiator) this.prepare();
  }

  get connected() {
    return this.state === 'connected';
  }

  get route() {
    return this.currentRoute;
  }

  send(message: DataMessage) {
    if (this.channel?.readyState === 'open') this.channel.send(encodeDataMessage(message));
  }

  async handleSignal({ description, candidate }: SignalPayload) {
    const pc = this.pc;
    try {
      if (description) {
        const collision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          this.prepare();
          await pc.setLocalDescription();
          this.hooks.signal({ description: pc.localDescription!.toJSON() });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn(`signaling error with ${this.id}`, err);
    }
  }

  async replaceLocalStream(local: MediaStream) {
    this.local = local;
    for (const sender of this.pc.getSenders()) {
      if (this.screenSenders.includes(sender)) continue;
      const track = local.getTracks().find((t) => t.kind === sender.track?.kind);
      if (track) await sender.replaceTrack(track);
    }
  }

  /** Starts or stops sending a shared screen to this peer, alongside the camera. */
  setScreen(screen: MediaStream | undefined) {
    for (const sender of this.screenSenders) {
      try {
        this.pc.removeTrack(sender);
      } catch {
        // The connection may already be closing.
      }
    }
    this.screenSenders = [];
    this.screen = screen;
    if (this.prepared) this.addScreenTracks();
  }

  private addScreenTracks() {
    if (!this.screen) return;
    for (const track of this.screen.getTracks()) this.screenSenders.push(this.pc.addTrack(track, this.screen));
    if (this.policy) void this.applySendPolicy(this.policy); // the new tracks follow the same limits
  }

  /** Applies video limits to what we send this peer; `video: false` stops sending video to them altogether. */
  async applySendPolicy(policy: SendPolicy) {
    this.policy = policy;
    for (const sender of this.pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      for (const encoding of params.encodings) {
        encoding.active = policy.video;
        encoding.maxBitrate = policy.tier.maxBitrate;
        encoding.scaleResolutionDownBy = policy.tier.scaleResolutionDownBy;
        encoding.maxFramerate = policy.tier.maxFramerate;
      }
      await sender.setParameters(params).catch(() => {});
    }
  }

  /** Looks at the selected candidate pair to see whether this connection runs through a relay. */
  async detectRoute() {
    try {
      const route = routeFromStats((await this.pc.getStats()) as unknown as StatsLike);
      if (route !== this.currentRoute) {
        this.currentRoute = route;
        this.hooks.route(route);
      }
    } catch {
      // The connection may have closed while asking.
    }
  }

  close() {
    clearTimeout(this.connectTimer);
    clearTimeout(this.disconnectTimer);
    clearInterval(this.routeTimer);
    this.pc.onnegotiationneeded = null;
    this.pc.oniceconnectionstatechange = null;
    this.channel?.close();
    this.pc.close();
  }

  private prepare() {
    if (this.prepared) return;
    this.prepared = true;
    for (const track of this.local.getTracks()) this.pc.addTrack(track, this.local);
    this.addScreenTracks();
    this.channel = this.pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    this.channel.onopen = () => this.hooks.channelOpen();
    this.channel.onmessage = (event) => {
      const message = parseDataMessage(event.data);
      if (message) this.hooks.message(message);
    };
  }

  private async makeOffer() {
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.hooks.signal({ description: this.pc.localDescription!.toJSON() });
    } catch (err) {
      console.warn(`could not create an offer for ${this.id}`, err);
    } finally {
      this.makingOffer = false;
    }
  }

  private onIceState() {
    const ice = this.pc.iceConnectionState;
    if (ice === 'connected' || ice === 'completed') {
      clearTimeout(this.connectTimer);
      clearTimeout(this.disconnectTimer);
      this.iceRestarts = 0;
      this.setState('connected');
      void this.detectRoute();
      clearInterval(this.routeTimer);
      this.routeTimer = setInterval(() => void this.detectRoute(), ROUTE_POLL_MS);
    } else if (ice === 'disconnected') {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = setTimeout(() => this.pc.restartIce(), DISCONNECT_GRACE_MS);
    } else if (ice === 'failed') {
      if (this.iceRestarts < MAX_ICE_RESTARTS) {
        this.iceRestarts += 1;
        this.pc.restartIce();
      } else {
        this.setState('unreachable');
      }
    }
  }

  private setState(state: PeerState) {
    if (state === this.state) return;
    this.state = state;
    this.hooks.state(state);
  }
}
