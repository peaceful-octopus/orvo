import { roomStatus } from '@chillcall/protocol';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bubble } from './Bubble';
import { useCall } from './callStore';
import { giphyApiKey } from './config';
import { useConfig } from './configStore';
import { ReactionBar } from './ReactionBar';
import { BubbleField, type Member } from './float/BubbleField';
import type { ControlAction } from './float/bridge';
import { useControlsWindow } from './float/controlsWindow';
import { FloatView } from './float/FloatView';
import { useFloat } from './float/float';
import { LAYOUT_MODES } from './float/layouts';
import { unreachableNotice } from './unreachable';
import { useUi } from './uiStore';

const GifPicker = lazy(() => import('./GifPicker'));

const MODE_LABELS = { row: 'Row', column: 'Column', campfire: 'Campfire' } as const;

export function RoomPage({ room }: { room: string }) {
  const {
    phase,
    error,
    local,
    localDisplay,
    effectsMessage,
    audio,
    video,
    remotes,
    reconnecting,
    startPreview,
    join,
    toggleAudio,
    toggleVideo,
    react,
    sendGif,
    leave,
  } = useCall();
  const { mode, setMode } = useUi();
  const limits = useConfig((s) => s.config.limits);
  const apiKey = useConfig((s) => giphyApiKey(s.config));
  const [gifOpen, setGifOpen] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem('chillcall:name') ?? '');

  useEffect(() => {
    void startPreview();
  }, [startPreview]);

  const members = useMemo<Member[]>(
    () => [
      { id: 'self', name, stream: localDisplay ?? local, video, audio, self: true },
      ...Object.values(remotes).map((p) => ({
        id: p.id,
        name: p.name,
        stream: p.stream,
        video: p.video,
        audio: p.audio,
        unreachable: p.state === 'unreachable',
        route: p.route,
      })),
    ],
    [name, local, localDisplay, video, audio, remotes],
  );

  const float = useFloat(mode, members.length);
  const onControlAction = (a: ControlAction) => {
    if (a.type === 'audio') toggleAudio();
    else if (a.type === 'video') toggleVideo();
    else if (a.type === 'react') void react(a.emoji);
    else if (a.type === 'gif') sendGif(a.source, a.mode).catch(() => {}); // the store already shows a message
    else void float.exit();
  };
  const controlsWindow = useControlsWindow(
    float.active && float.kind === 'tauri',
    { audio, video, giphyKey: apiKey },
    onControlAction,
  );

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

  const floatView = (inWindow: boolean) => (
    <FloatView
      members={members}
      mode={mode}
      draggable={inWindow}
      hot={inWindow ? controlsWindow.hot : undefined}
      inlineControls={
        inWindow
          ? undefined
          : {
              audio,
              video,
              onToggleAudio: toggleAudio,
              onToggleVideo: toggleVideo,
              onReact: (emoji) => void react(emoji),
              onExpand: () => void float.exit(),
              onGif: apiKey ? () => setGifOpen(true) : undefined,
            }
      }
    />
  );

  // In Tauri the window itself shrinks into the floating view.
  if (float.active && float.kind === 'tauri') return floatView(true);

  const status = roomStatus(members.length, limits);
  const notice = unreachableNotice(members.filter((m) => m.unreachable).map((m) => m.name));

  return (
    <main className="call">
      {effectsMessage && (
        <p className="banner" role="status">
          {effectsMessage}
        </p>
      )}
      {reconnecting && <p className="banner">Reconnecting to the server... your call continues.</p>}
      {notice && (
        <p className="banner" role="alert">
          {notice}
        </p>
      )}
      {status !== 'ok' && (
        <p className="banner">
          More than {limits.warnRoomSize} people are here, so video quality may be degraded.
        </p>
      )}
      <BubbleField members={members} mode={mode} />
      <ReactionBar disabled={!video} onReact={(emoji) => void react(emoji)} onGif={apiKey ? () => setGifOpen(true) : undefined} />
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
      {gifOpen && apiKey && (
        <Suspense fallback={null}>
          <GifPicker
            apiKey={apiKey}
            onClose={() => setGifOpen(false)}
            onPick={(source, mode) => {
              setGifOpen(false);
              sendGif(source, mode).catch(() => {}); // the store already shows a message
            }}
          />
        </Suspense>
      )}
      {float.pip && createPortal(floatView(false), float.pip.document.body)}
    </main>
  );
}
