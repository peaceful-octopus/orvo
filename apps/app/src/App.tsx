import { isValidRoomSlug } from '@chillcall/protocol';
import { useState } from 'react';
import { CLIENT_VERSION, defaultServerUrl, getServerUrl, setServerUrl, setTelemetryAllowed, telemetryAllowed } from './config';
import { updateRequired } from './configLogic';
import { useConfig } from './configStore';
import { AnnouncementBanner, UpdateRequired } from './Notices';
import { RoomPage } from './RoomPage';
import { setTelemetryEnabled } from './telemetry';

function Home() {
  const maxRoomSize = useConfig((s) => s.config.limits.maxRoomSize);
  const [error, setError] = useState<string>();
  const [server, setServer] = useState(getServerUrl());
  const [saved, setSaved] = useState(false);
  const [shareStats, setShareStats] = useState(telemetryAllowed());

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
      <p>Casual video calls. Rooms hold up to {maxRoomSize} people.</p>
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
            if (ok) {
              setServer(getServerUrl());
              void useConfig.getState().refresh();
            }
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

      <details className="server">
        <summary>Privacy</summary>
        <label className="hint">
          <input
            type="checkbox"
            checked={shareStats}
            onChange={(e) => {
              setShareStats(e.target.checked);
              setTelemetryAllowed(e.target.checked);
              setTelemetryEnabled(e.target.checked);
            }}
          />{' '}
          Share anonymous connection statistics with this server (whether calls connect directly, and how fast). No names, rooms or addresses.
        </label>
      </details>
    </main>
  );
}

export function App() {
  const config = useConfig((s) => s.config);
  if (updateRequired(config, CLIENT_VERSION)) return <UpdateRequired />;

  const room = location.pathname.match(/^\/r\/([^/]+)$/)?.[1];
  return (
    <>
      <AnnouncementBanner />
      {room && isValidRoomSlug(room) ? <RoomPage room={room} /> : <Home />}
    </>
  );
}
