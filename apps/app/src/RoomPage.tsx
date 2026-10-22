import { WARN_ROOM_SIZE, roomStatus } from '@chillcall/rtc';
import { useEffect, useState } from 'react';
import { Bubble } from './Bubble';
import { useCall } from './callStore';

export function RoomPage({ room }: { room: string }) {
  const { phase, error, local, audio, video, remotes, startPreview, join, toggleAudio, toggleVideo, leave } =
    useCall();
  const [name, setName] = useState(() => localStorage.getItem('chillcall:name') ?? '');

  useEffect(() => {
    void startPreview();
  }, [startPreview]);

  if (phase !== 'in-call') {
    return (
      <main>
        <h1>Join {room}</h1>
        <Bubble name={name} stream={local} videoOn={video} audioOn={audio} mirrored muteAudio />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            localStorage.setItem('chillcall:name', name);
            void join(room, name.trim());
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
          <button disabled={!local || phase === 'joining'}>{phase === 'joining' ? 'Joining...' : 'Join'}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  const people = Object.values(remotes);
  const status = roomStatus(people.length + 1);

  return (
    <main className="call">
      {status !== 'ok' && (
        <p className="banner">
          More than {WARN_ROOM_SIZE} people are here, so video quality may be degraded.
        </p>
      )}
      <div className="grid">
        <Bubble name={name} stream={local} videoOn={video} audioOn={audio} mirrored muteAudio />
        {people.map((p) => (
          <Bubble key={p.id} name={p.name} stream={p.stream} videoOn={p.video} audioOn={p.audio} />
        ))}
      </div>
      <nav className="controls">
        <button onClick={toggleAudio}>{audio ? 'Mute' : 'Unmute'}</button>
        <button onClick={toggleVideo}>{video ? 'Camera off' : 'Camera on'}</button>
        <button
          onClick={() => {
            leave();
            location.assign('/');
          }}
        >
          Leave
        </button>
      </nav>
    </main>
  );
}
