import {
  ACTIVITY_API_VERSION,
  MAX_ACTIVITY_MESSAGES_PER_SECOND,
  parseGuestMessage,
  type ActivityDataMessages,
  type ActivityHostMessage,
  type ActivityParticipant,
} from '@orvo/protocol';

export interface BridgeOptions {
  instanceId: string;
  self: ActivityParticipant;
  /** The participant who started the activity and runs it. */
  host: string;
  participants: ActivityParticipant[];
  theme: Record<string, string>;
  /** Delivers a message to the activity's frame. */
  post(message: ActivityHostMessage): void;
  /** Sends an activity message to the other participants. */
  send(message: ActivityDataMessages): void;
  /** The activity asked to start: announce that it is open. */
  onReady(): void;
  /** The host's activity asked to end for everyone. */
  onEnd(): void;
  now?: () => number;
}

/**
 * Connects one activity frame to the call. Everything the frame sends is validated and rate limited here, and
 * everything it receives comes from people who have the activity open, so a misbehaving activity or peer cannot
 * flood the others or reach anything beyond its own messages.
 */
export class ActivityBridge {
  private ready = false;
  private participants = new Map<string, ActivityParticipant>();
  private windows = new Map<string, { start: number; count: number }>();
  private now: () => number;

  constructor(private opts: BridgeOptions) {
    this.now = opts.now ?? Date.now;
    for (const p of opts.participants) this.participants.set(p.id, p);
  }

  /** Something the frame posted to the page. Anything that is not a valid message is dropped. */
  fromFrame(raw: unknown): void {
    const message = parseGuestMessage(raw);
    if (!message) return;
    if (message.type === 'ready') {
      if (this.ready) return;
      this.ready = true;
      this.opts.post({
        orvo: ACTIVITY_API_VERSION,
        type: 'init',
        apiVersion: ACTIVITY_API_VERSION,
        instanceId: this.opts.instanceId,
        self: this.opts.self,
        host: this.opts.host,
        isHost: this.opts.host === this.opts.self.id,
        participants: [...this.participants.values()],
        theme: this.opts.theme,
        capabilities: [],
      });
      this.opts.onReady();
    } else if (!this.ready) {
      return;
    } else if (message.type === 'send') {
      if (!this.allow(this.opts.self.id)) return;
      this.opts.send({
        kind: 'activity-msg',
        instanceId: this.opts.instanceId,
        ...(message.to === undefined ? {} : { to: message.to }),
        data: message.data,
      });
    } else if (message.type === 'end' && this.opts.host === this.opts.self.id) {
      this.opts.onEnd();
    }
  }

  /** A message from another participant's activity. */
  fromPeer(from: string, message: ActivityDataMessages): void {
    if (message.kind !== 'activity-msg' || message.instanceId !== this.opts.instanceId) return;
    if (message.to !== undefined && message.to !== this.opts.self.id) return;
    if (!this.ready || !this.participants.has(from) || !this.allow(from)) return;
    this.opts.post({ orvo: ACTIVITY_API_VERSION, type: 'message', from, data: message.data });
  }

  /** The people who have the activity open changed. */
  setParticipants(next: ActivityParticipant[]): void {
    const nextIds = new Set(next.map((p) => p.id));
    for (const id of [...this.participants.keys()]) {
      if (nextIds.has(id)) continue;
      this.participants.delete(id);
      this.windows.delete(id);
      if (this.ready) this.opts.post({ orvo: ACTIVITY_API_VERSION, type: 'participant-left', id });
    }
    for (const participant of next) {
      if (this.participants.has(participant.id)) {
        this.participants.set(participant.id, participant);
        continue;
      }
      this.participants.set(participant.id, participant);
      if (this.ready) this.opts.post({ orvo: ACTIVITY_API_VERSION, type: 'participant-joined', participant });
    }
  }

  /** Tells the frame the activity is over. */
  close(): void {
    if (this.ready) this.opts.post({ orvo: ACTIVITY_API_VERSION, type: 'close' });
  }

  /** One-second windows per participant; the frame's own sending counts as the local participant. */
  private allow(who: string): boolean {
    const t = this.now();
    const w = this.windows.get(who);
    if (!w || t - w.start >= 1000) {
      this.windows.set(who, { start: t, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= MAX_ACTIVITY_MESSAGES_PER_SECOND;
  }
}
