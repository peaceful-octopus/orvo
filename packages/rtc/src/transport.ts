export interface Participant {
  id: string;
  name: string;
  stream?: MediaStream;
}

export type RoomEvent =
  | { type: 'participant-joined'; participant: Participant }
  | { type: 'participant-left'; id: string }
  | { type: 'stream'; id: string; stream: MediaStream }
  | { type: 'message'; id: string; data: unknown };

/** Abstraction over how media reaches peers, so a mesh and an SFU can be swapped. */
export interface RoomTransport {
  join(room: string, name: string, local: MediaStream): Promise<void>;
  leave(): void;
  send(data: unknown): void;
  replaceLocalStream(local: MediaStream): Promise<void>;
  on(handler: (event: RoomEvent) => void): () => void;
}
