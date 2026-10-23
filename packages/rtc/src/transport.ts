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
  | { type: 'connection'; state: ConnectionState; reason?: string }
  /** The room's owner removed you. The transport has already left the room. */
  | { type: 'kicked' };

/** Abstraction over how media reaches peers, so a mesh and an SFU can be swapped. */
export interface RoomTransport {
  join(room: string, name: string, local: MediaStream): Promise<void>;
  leave(): void;
  send(message: DataMessage): void;
  replaceLocalStream(local: MediaStream): Promise<void>;
  /** Owner only: removes someone from the room and keeps them out. */
  kick(peerId: string): void;
  /** Shares a screen alongside the camera; undefined stops sharing. */
  setScreenStream(screen: MediaStream | undefined): void;
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

/** The server wants the person signed in first: to start a room, or to join this one. */
export class LoginRequiredError extends Error {
  constructor(readonly reason: 'create' | 'join') {
    super(reason === 'create' ? 'Sign in to start a room.' : 'This room is for signed-in people. Sign in to join.');
  }
}

/** The sign-in sent with a request was not accepted, for instance because it ran out; signing in again fixes it. */
export class InvalidTokenError extends Error {
  constructor() {
    super('Your sign-in has expired. Sign in again.');
  }
}

/** The owner locked the room, and this person was not already in it. */
export class RoomLockedError extends Error {
  constructor() {
    super('This room is locked. Only people who were already in it can join.');
  }
}

/** The room's owner removed this person from the room. */
export class KickedError extends Error {
  constructor() {
    super('The owner of this room removed you from it.');
  }
}
