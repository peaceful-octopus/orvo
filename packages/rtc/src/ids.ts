const ROOM_SLUG = /^[a-z0-9-]{3,40}$/;

export const PEER_PATH = '/chillcall';

export function isValidRoomSlug(slug: string): boolean {
  return ROOM_SLUG.test(slug);
}

/** Peer ids encode their room (`<slug>_<suffix>`), so the server can count room members. */
export function peerIdFor(room: string): string {
  return `${room}_${crypto.randomUUID().slice(0, 8)}`;
}

export function roomOfPeerId(peerId: string): string | null {
  const room = peerId.split('_')[0] ?? '';
  return peerId.includes('_') && isValidRoomSlug(room) ? room : null;
}
