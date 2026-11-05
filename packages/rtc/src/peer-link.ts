import { encodeDataMessage, parseDataMessage, type DataMessage } from '@orvo/protocol';
import { canMap, isPrivateIpv4, mappedCandidate, parseCandidate, type ParsedCandidate, type PortMapper } from './port-mapping';
import { candidateAddress, routeFromStats, selectedPair, type Route, type SendPolicy, type StatsLike } from './route';
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
  /** The connection's stats, each time the route is checked. */
  stats?(report: StatsLike): void;
}

const CONNECT_TIMEOUT_MS = 25_000;
const DISCONNECT_GRACE_MS = 4_000;
const MAX_ICE_RESTARTS = 2;
const ROUTE_POLL_MS = 10_000;
/** A router that has not answered by now is not waited for; the connection goes ahead without the mapping. */
const PORT_MAP_TIMEOUT_MS = 8_000;

export interface PeerLinkOptions {
  /** Asks the router to forward our ports, where the platform can (see `PortMapper`). */
  portMapper?: PortMapper;
}

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
  /** True while a remote answer is being applied, when the signaling state still reads `have-local-offer`. */
  private settingRemoteAnswer = false;
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
  /** Local `address:port`s we asked the router to forward, whether or not it has answered yet; released on close. */
  private mappings = new Set<string>();
  /** Those the router forwards and the other peer has been told about. */
  private forwarded = new Set<string>();
  /** Our public IPv4 addresses as STUN reports them; a router reporting another is behind a further NAT. */
  private reflexive = new Set<string>();
  private usesMapping = false;
  private closed = false;

  constructor(
    readonly id: string,
    selfId: string,
    config: RTCConfiguration,
    private local: MediaStream,
    private hooks: PeerLinkHooks,
    /** The initiator adds its media immediately; a responder adds it after the remote offer is applied. */
    initiator: boolean,
    private options: PeerLinkOptions = {},
  ) {
    this.polite = selfId < id;
    this.pc = new RTCPeerConnection(config);
    this.pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const json = candidate.toJSON();
      hooks.signal({ candidate: json });
      this.onLocalCandidate(json);
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

  /** Whether the connection runs through a port our router forwards for us (see `PortMapper`). */
  get viaPortMapping() {
    return this.usesMapping;
  }

  send(message: DataMessage) {
    if (this.channel?.readyState === 'open') this.channel.send(encodeDataMessage(message));
  }

  async handleSignal({ description, candidate }: SignalPayload) {
    const pc = this.pc;
    try {
      if (description) {
        // Signals are handled as they arrive, so an offer can arrive while the answer just before it is still being applied.
        // The state then still reads `have-local-offer`, but that is no collision: the browser queues the offer behind the answer.
        // Counting it as one made the impolite peer drop the offer for good, which lost a screen share that began during the join.
        const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.settingRemoteAnswer);
        const collision = description.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        this.settingRemoteAnswer = description.type === 'answer';
        try {
          await pc.setRemoteDescription(description);
        } finally {
          this.settingRemoteAnswer = false;
        }
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
    // Stop the old screen's transceivers rather than only removing their tracks. A removed track leaves its m-line in
    // every later offer with all its codecs, so each share would make the offer bigger until the signaling server
    // refused it; a stopped one is recycled by the next share.
    for (const sender of this.screenSenders) {
      try {
        this.pc.getTransceivers().find((t) => t.sender === sender)?.stop();
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
      const report = (await this.pc.getStats()) as unknown as StatsLike;
      const route = routeFromStats(report);
      this.hooks.stats?.(report);
      this.usesMapping = this.pairUsesMapping(report);
      if (route !== this.currentRoute) {
        this.currentRoute = route;
        this.hooks.route(route);
      }
    } catch {
      // The connection may have closed while asking.
    }
  }

  close() {
    this.closed = true;
    for (const key of this.mappings) {
      const [ip, port] = key.split(':') as [string, string];
      void this.options.portMapper?.unmap(ip, Number(port)).catch(() => {});
    }
    this.mappings.clear();
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

  private onLocalCandidate(json: RTCIceCandidateInit) {
    const parsed = json.candidate ? parseCandidate(json.candidate) : undefined;
    if (!parsed) return;
    if (parsed.type === 'srflx' && parsed.address.includes('.')) this.reflexive.add(parsed.address);
    if (this.options.portMapper && canMap(parsed)) void this.mapPort(json, parsed);
  }

  /**
   * Asks the router to forward this local port and, if it does, tells the other peer the router's public address
   * for it. Their checks then arrive at our port through the router, so a strict NAT on their side no longer matters.
   * The port is tried once per connection; after an ICE restart the browser gathers new ports, which are tried anew.
   */
  private async mapPort(json: RTCIceCandidateInit, host: ParsedCandidate) {
    const mapper = this.options.portMapper!;
    const key = `${host.address}:${host.port}`;
    if (this.mappings.has(key)) return;
    this.mappings.add(key);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the router did not answer in time')), PORT_MAP_TIMEOUT_MS);
      });
      const mapping = await Promise.race([mapper.map(host.address, host.port), timeout]);
      if (this.closed) return; // close() has already released it
      if (this.reflexive.size && !this.reflexive.has(mapping.externalIp)) {
        // The internet sees us at another address, so the router is behind a further NAT and its port is unreachable.
        this.mappings.delete(key);
        await mapper.unmap(host.address, host.port);
        return;
      }
      this.forwarded.add(key);
      this.hooks.signal({ candidate: mappedCandidate(json, host, mapping) });
    } catch (err) {
      console.debug(`no router port mapping for ${this.id}:`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Whether the pair in use is one of our forwarded ports talking to someone outside our network. Someone on the same
   * network reaches our port directly, mapping or not.
   */
  private pairUsesMapping(report: StatsLike): boolean {
    const pair = selectedPair(report);
    const local = candidateAddress(pair?.local);
    const remote = candidateAddress(pair?.remote);
    if (!local || !remote || pair?.local?.candidateType !== 'host') return false;
    return this.forwarded.has(`${local.address}:${local.port}`) && !isPrivateIpv4(remote.address);
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
