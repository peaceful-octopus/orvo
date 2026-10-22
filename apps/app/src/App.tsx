import { MAX_ROOM_SIZE, isValidRoomSlug } from '@chillcall/rtc';
import { RoomPage } from './RoomPage';

const WORDS = ['cozy', 'sunny', 'quiet', 'mellow', 'fuzzy', 'breezy', 'lazy', 'cosmic'];
const THINGS = ['fox', 'campfire', 'porch', 'couch', 'garden', 'lantern', 'cabin', 'pond'];

function randomSlug() {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(WORDS)}-${pick(THINGS)}-${Math.floor(Math.random() * 90 + 10)}`;
}

export function App() {
  const room = location.pathname.match(/^\/r\/([^/]+)$/)?.[1];
  if (room && isValidRoomSlug(room)) return <RoomPage room={room} />;

  return (
    <main>
      <h1>ChillCall</h1>
      <p>Casual video calls. Rooms hold up to {MAX_ROOM_SIZE} people.</p>
      <button onClick={() => location.assign(`/r/${randomSlug()}`)}>Start a room</button>
    </main>
  );
}
