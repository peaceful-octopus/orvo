import { MAX_ROOM_SIZE, roomOfPeerId, roomStatus } from '@chillcall/rtc/shared';

/** Tracks which peer ids are connected to which room, and enforces the room size cap. */
export class RoomRegistry {
  private rooms = new Map<string, Set<string>>();

  /** Returns false when the peer id is malformed or its room is already full. */
  add(peerId: string): boolean {
    const room = roomOfPeerId(peerId);
    if (!room) return false;
    const members = this.rooms.get(room) ?? new Set<string>();
    if (!members.has(peerId) && members.size >= MAX_ROOM_SIZE) return false;
    members.add(peerId);
    this.rooms.set(room, members);
    return true;
  }

  remove(peerId: string): void {
    const room = roomOfPeerId(peerId);
    if (!room) return;
    const members = this.rooms.get(room);
    members?.delete(peerId);
    if (members?.size === 0) this.rooms.delete(room);
  }

  info(room: string) {
    const peers = [...(this.rooms.get(room) ?? [])];
    return { peers, status: roomStatus(peers.length) };
  }
}
