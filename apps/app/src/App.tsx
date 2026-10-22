import { MAX_ROOM_SIZE, isValidRoomSlug } from '@chillcall/protocol';
import { useState } from 'react';
import { defaultServerUrl, getServerUrl, setServerUrl } from './config';
import { RoomPage } from './RoomPage';

function Home() {
  const [error, setError] = useState<string>();
  const [server, setServer] = useState(getServerUrl());
  const [saved, setSaved] = useState(false);

  const startRoom = async () => {
    setError(undefined);
    try {
      const res = await fetch(new URL('/v1/rooms', getServerUrl()), { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { room } = (await res.json()) as { room: string };
      location.assign(`/r/${room}`);
    } catch {
      setError(`Could not reach the server at ${getServerUrl()}.`);
    }
  };

  return (
    <main>
      <h1>ChillCall</h1>
      <p>Casual video calls. Rooms hold up to {MAX_ROOM_SIZE} people.</p>
      <button onClick={() => void startRoom()}>Start a room</button>
      {error && <p className="error">{error}</p>}

      <details className="server">
        <summary>Server</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const ok = setServerUrl(server);
            setSaved(ok);
            setError(ok ? undefined : 'That is not a valid server address.');
            if (ok) setServer(getServerUrl());
          }}
        >
          <input
            value={server}
            onChange={(e) => {
              setServer(e.target.value);
              setSaved(false);
            }}
            placeholder={defaultServerUrl()}
            aria-label="Server address"
          />
          <button>{saved ? 'Saved' : 'Save'}</button>
        </form>
        <p className="hint">Leave empty to use the default ({defaultServerUrl()}).</p>
      </details>
    </main>
  );
}

export function App() {
  const room = location.pathname.match(/^\/r\/([^/]+)$/)?.[1];
  if (room && isValidRoomSlug(room)) return <RoomPage room={room} />;
  return <Home />;
}
