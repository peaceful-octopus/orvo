import type { DataMessage } from '@chillcall/protocol';

export interface Participant {
  id: string;
  name: string;
}

export type PeerState = 'connecting' | 'connected' | 'unreachable';

export type PeerRoute = 'direct' | 'relay' | 'unknown';

export type ConnectionState = 'connected' | 'reconnecting' | 'closed';

export type RoomEvent =
  | { type: 'participant-joined'; participant: Participant }
  | { type: 'participant-left'; id: string }
  | { type: 'stream'; id: string; stream: MediaStream }
  | { type: 'message'; id: string; data: DataMessage }
  /** Direct connection to one peer: `unreachable` when their network blocks it and no relay is available. */
  | { type: 'peer-state'; id: string; state: PeerState }
  /** How the connection to a peer is routed: straight to them, or through a relay. */
  | { type: 'peer-route'; id: string; route: PeerRoute }
  /** Health of the signaling connection; calls between connected peers continue while it reconnects. */
  | { type: 'connection'; state: ConnectionState; reason?: string };

/** Abstraction over how media reaches peers, so a mesh and an SFU can be swapped. */
export interface RoomTransport {
  join(room: string, name: string, local: MediaStream): Promise<void>;
  leave(): void;
  send(message: DataMessage): void;
  replaceLocalStream(local: MediaStream): Promise<void>;
  on(handler: (event: RoomEvent) => void): () => void;
}

export class RoomFullError extends Error {
  constructor() {
    super('This room is full.');
  }
}

export class UpgradeRequiredError extends Error {
  constructor() {
    super('Please update ChillCall to join this room.');
  }
}

export class JoinError extends Error {}

/** No beacon answered usefully (all unreachable or failing), as opposed to a node refusing or being unreachable. */
export class BeaconUnavailableError extends JoinError {}
