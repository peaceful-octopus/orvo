import { encodeDataMessage, parseDataMessage, type DataMessage } from '@chillcall/protocol';
import type { VideoTier } from '@chillcall/protocol';
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
  channelOpen(): void;
}

const CONNECT_TIMEOUT_MS = 25_000;
const DISCONNECT_GRACE_MS = 4_000;
const MAX_ICE_RESTARTS = 2;

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
  private readonly polite: boolean;

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
      const track = local.getTracks().find((t) => t.kind === sender.track?.kind);
      if (track) await sender.replaceTrack(track);
    }
  }

  async applyVideoTier(tier: VideoTier) {
    for (const sender of this.pc.getSenders()) {
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

  close() {
    clearTimeout(this.connectTimer);
    clearTimeout(this.disconnectTimer);
    this.pc.onnegotiationneeded = null;
    this.pc.oniceconnectionstatechange = null;
    this.channel?.close();
    this.pc.close();
  }

  private prepare() {
    if (this.prepared) return;
    this.prepared = true;
    for (const track of this.local.getTracks()) this.pc.addTrack(track, this.local);
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
