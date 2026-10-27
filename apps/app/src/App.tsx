import { isValidRoomSlug } from '@orvo/protocol';
import { useState } from 'react';
import { AdminPage } from './AdminPage';
import { AuthCallback, SignInCard, useSignIn } from './auth/AccountUi';
import { useAuth } from './auth/authStore';
import { COPY } from './copy';
import { CLIENT_VERSION, getServerUrl } from './config';
import { updateRequired } from './configLogic';
import { useConfig } from './configStore';
import { AnnouncementBanner, UpdateBanner, UpdateRequired } from './Notices';
import { Wordmark } from './Wordmark';
import { RoomPage } from './RoomPage';
import { SettingsButton } from './SettingsPane';
import { Toasts } from './Toasts';
import { parseRoomInput } from './roomInput';

function Home() {
  const maxRoomSize = useConfig((s) => s.config.limits.maxRoomSize);
  const [error, setError] = useState<string>();
  const [roomName, setRoomName] = useState('');
  const [signedInOnly, setSignedInOnly] = useState(false);
  const auth = useConfig((s) => s.config.auth);
  // Only a config fetched from the server proves it exists; a cached or built-in one means it did not answer.
  const unreachable = useConfig((s) => s.loaded && s.source !== 'network');
  const signedIn = useAuth((s) => Boolean(s.session));
  const signIn = useSignIn();
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const startRoom = async () => {
    setError(undefined);
    if (auth?.createRequiresLogin && !signedIn) return signIn();
    try {
      const token = await useAuth.getState().token();
      const res = await fetch(new URL('/v1/rooms', getServerUrl()), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ signedInOnly }),
      });
      if (res.status === 401) {
        // The server wants an account first, or the one we had ran out.
        useAuth.getState().signOut();
        setNeedsSignIn(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { room } = (await res.json()) as { room: string };
      location.assign(`/r/${room}`);
    } catch {
      setError(`Could not reach the server at ${getServerUrl()}.`);
    }
  };

  return (
    <main>
      <SettingsButton />
      <Wordmark className="wordmark-header" />
      <div className="home">
        <div>
          <h1>
            No agenda.
            <br />
            Just company.
          </h1>
          <p>
            Orvo is a casual video chat app for friends and family. No meetings, no schedule, just a room and the people you
            like.
          </p>
          <p className="room-size">Rooms hold up to {maxRoomSize} people.</p>
          {unreachable && (
            <section className="state-card" role="alert">
              <h2>{COPY.serverUnreachable.title}</h2>
              <p>{COPY.serverUnreachable.body(getServerUrl())}</p>
              <div className="actions">
                <button onClick={() => void useConfig.getState().refresh()}>{COPY.serverUnreachable.retry}</button>
              </div>
            </section>
          )}
          <div className="home-actions" hidden={unreachable}>
            <button className="primary big" onClick={() => void startRoom()}>
              {auth?.createRequiresLogin && !signedIn ? COPY.account.signInToStart : 'Start a room'}
            </button>
            {auth && (
              <label className="toggle">
                <input type="checkbox" checked={signedInOnly} onChange={(e) => setSignedInOnly(e.target.checked)} />
                {COPY.account.onlySignedIn}
              </label>
            )}
            {needsSignIn && <SignInCard title={COPY.account.expired.title} body={COPY.account.expired.body} />}
            <form
              className="join-room"
              onSubmit={(e) => {
                e.preventDefault();
                const room = parseRoomInput(roomName);
                if (room) location.assign(`/r/${room}`);
                else setError('Enter a room name (letters, numbers and hyphens) or paste a room link.');
              }}
            >
              <input
                value={roomName}
                onChange={(e) => {
                  setRoomName(e.target.value);
                  setError(undefined);
                }}
                placeholder="Room name or link"
                aria-label="Room name or link"
              />
              <button>Join a room</button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
        <Ring />
      </div>
    </main>
  );
}

/** The Orvo mark: three circles of different sizes. */
function Ring() {
  return (
    <svg className="ring" viewBox="6 9.92 88 80.17" aria-hidden="true">
      <circle cx="35.01" cy="57.98" r="29.01" fill="var(--text)" />
      <circle cx="75.63" cy="28.29" r="18.37" fill="var(--accent)" />
      <circle cx="71.76" cy="79.45" r="10.64" fill="var(--text)" />
    </svg>
  );
}

export function App() {
  const config = useConfig((s) => s.config);
  // Before the update check: a minimum version set by mistake must not lock the operator out of the page that fixes it.
  if (location.pathname === '/admin') return <><Toasts /><AdminPage /></>;
  if (updateRequired(config, CLIENT_VERSION)) return <UpdateRequired />;

  if (location.pathname === '/auth/callback') return <AuthCallback />;

  const room = location.pathname.match(/^\/r\/([^/]+)$/)?.[1];
  return (
    <>
      <AnnouncementBanner />
      <UpdateBanner />
      <Toasts />
      {room && isValidRoomSlug(room) ? <RoomPage room={room} /> : <Home />}
    </>
  );
}
