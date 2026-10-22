import { WARN_ROOM_SIZE, roomStatus } from '@chillcall/rtc';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bubble } from './Bubble';
import { useCall } from './callStore';
import { BubbleField, type Member } from './float/BubbleField';
import { FloatView } from './float/FloatView';
import { useFloat } from './float/float';
import { LAYOUT_MODES } from './float/layouts';
import { useUi } from './uiStore';

const MODE_LABELS = { row: 'Row', column: 'Column', campfire: 'Campfire' } as const;

export function RoomPage({ room }: { room: string }) {
  const { phase, error, local, audio, video, remotes, startPreview, join, toggleAudio, toggleVideo, leave } =
    useCall();
  const { mode, setMode } = useUi();
  const [name, setName] = useState(() => localStorage.getItem('chillcall:name') ?? '');

  useEffect(() => {
    void startPreview();
  }, [startPreview]);

  const members = useMemo<Member[]>(
    () => [
      { id: 'self', name, stream: local, video, audio, self: true },
      ...Object.values(remotes).map((p) => ({
        id: p.id,
        name: p.name,
        stream: p.stream,
        video: p.video,
        audio: p.audio,
      })),
    ],
    [name, local, video, audio, remotes],
  );

  const float = useFloat(mode, members.length);

  if (phase !== 'in-call') {
    return (
      <main>
        <h1>Join {room}</h1>
        <div className="preview">
          <Bubble name={name} stream={local} videoOn={video} audioOn={audio} mirrored muteAudio />
        </div>
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

  const floatView = (draggable: boolean) => (
    <FloatView
      members={members}
      mode={mode}
      audio={audio}
      video={video}
      draggable={draggable}
      onToggleAudio={toggleAudio}
      onToggleVideo={toggleVideo}
      onExpand={() => void float.exit()}
    />
  );

  // In Tauri the window itself shrinks into the floating view.
  if (float.active && float.kind === 'tauri') return floatView(true);

  const status = roomStatus(members.length);

  return (
    <main className="call">
      {status !== 'ok' && (
        <p className="banner">
          More than {WARN_ROOM_SIZE} people are here, so video quality may be degraded.
        </p>
      )}
      <BubbleField members={members} mode={mode} />
      <nav className="controls">
        <div className="modes" role="group" aria-label="Layout">
          {LAYOUT_MODES.map((m) => (
            <button key={m} aria-pressed={m === mode} onClick={() => setMode(m)}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <button onClick={toggleAudio}>{audio ? 'Mute' : 'Unmute'}</button>
        <button onClick={toggleVideo}>{video ? 'Camera off' : 'Camera on'}</button>
        {float.kind && (
          <button onClick={() => void (float.active ? float.exit() : float.enter())}>
            {float.active ? 'Dock' : 'Float'}
          </button>
        )}
        <button
          onClick={() => {
            leave();
            location.assign('/');
          }}
        >
          Leave
        </button>
      </nav>
      {float.pip && createPortal(floatView(false), float.pip.document.body)}
    </main>
  );
}
