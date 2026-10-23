import { isValidRoomSlug } from '@chillcall/protocol';
import { useState } from 'react';
import { AuthCallback, SignInCard, useSignIn } from './auth/AccountUi';
import { useAuth } from './auth/authStore';
import { COPY } from './copy';
import { CLIENT_VERSION, getServerUrl } from './config';
import { updateRequired } from './configLogic';
import { useConfig } from './configStore';
import { AnnouncementBanner, UpdateRequired } from './Notices';
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
      <div className="home">
        <div>
          <h1>ChillCall</h1>
          <p>Casual video calls. Rooms hold up to {maxRoomSize} people.</p>
          <div className="home-actions">
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

/** The campfire layout as a picture: a ring of bubbles. */
function Ring() {
  const bubbles = [
    ['var(--accent)', 0],
    ['var(--live)', 1],
    ['var(--muted)', 2],
    ['var(--border-strong)', 3],
    ['var(--hover)', 4],
  ] as const;
  return (
    <svg className="ring" viewBox="-110 -110 220 220" aria-hidden="true">
      {bubbles.map(([fill, i]) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / bubbles.length;
        return <circle key={i} cx={Math.cos(angle) * 62} cy={Math.sin(angle) * 62} r={i === 0 ? 40 : 34} fill={fill} />;
      })}
    </svg>
  );
}

export function App() {
  const config = useConfig((s) => s.config);
  if (updateRequired(config, CLIENT_VERSION)) return <UpdateRequired />;

  if (location.pathname === '/auth/callback') return <AuthCallback />;

  const room = location.pathname.match(/^\/r\/([^/]+)$/)?.[1];
  return (
    <>
      <AnnouncementBanner />
      <Toasts />
      {room && isValidRoomSlug(room) ? <RoomPage room={room} /> : <Home />}
    </>
  );
}
