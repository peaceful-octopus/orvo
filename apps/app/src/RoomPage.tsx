import { roomStatus } from '@chillcall/protocol';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bubble } from './Bubble';
import { useCall } from './callStore';
import { getServerUrl, giphyApiKey } from './config';
import { useConfig } from './configStore';
import { copyText, roomLink } from './roomInput';
import { DeviceButton, DeviceSelects } from './DeviceMenu';
import { canSelectOutput } from './devices';
import { ReactionBar } from './ReactionBar';
import { BubbleField, type Member } from './float/BubbleField';
import type { ControlAction } from './float/bridge';
import { useControlsWindow } from './float/controlsWindow';
import { FloatView } from './float/FloatView';
import { useFloat } from './float/float';
import {
  CampfireIcon,
  CheckIcon,
  ColumnIcon,
  DockIcon,
  FloatIcon,
  LeaveIcon,
  LinkIcon,
  MicIcon,
  MicOffIcon,
  RowIcon,
  VideoIcon,
  VideoOffIcon,
} from './float/icons';
import { LAYOUT_MODES } from './float/layouts';
import { unreachableNotice } from './unreachable';
import { useUi } from './uiStore';
import type { DeviceKind } from './devices';

const GifPicker = lazy(() => import('./GifPicker'));

const MODE_LABELS = { row: 'Row', column: 'Column', campfire: 'Campfire' } as const;
const MODE_ICONS = { row: <RowIcon />, column: <ColumnIcon />, campfire: <CampfireIcon /> } as const;

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
    devices,
    selected,
    selectDevice,
    leave,
  } = useCall();
  const outputs = canSelectOutput();
  const deviceProps = { devices, selected, canSelectOutput: outputs, onSelect: (kind: DeviceKind, id: string) => void selectDevice(kind, id) };
  const { mode, setMode } = useUi();
  const limits = useConfig((s) => s.config.limits);
  const apiKey = useConfig((s) => giphyApiKey(s.config));
  const [gifOpen, setGifOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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
    else if (a.type === 'device') void selectDevice(a.kind, a.id);
    else if (a.type === 'leave') void leaveCall();
    else void float.exit();
  };
  const leaveCall = async () => {
    await float.exit(); // restore the full window before the page reloads
    leave();
    location.assign('/');
  };
  const controlsWindow = useControlsWindow(
    float.active && float.kind === 'tauri',
    { audio, video, giphyKey: apiKey, devices, selected, canSelectOutput: outputs },
    onControlAction,
  );

  if (phase !== 'in-call') {
    return (
      <main>
        <h1>Join {room}</h1>
        <div className="preview">
          <Bubble name={name} stream={local} videoOn={video} audioOn={audio} mirrored muteAudio />
        </div>
        <DeviceSelects {...deviceProps} />
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
              onLeave: () => void leaveCall(),
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
            <button key={m} className="icon" aria-pressed={m === mode} aria-label={MODE_LABELS[m]} title={MODE_LABELS[m]} onClick={() => setMode(m)}>
              {MODE_ICONS[m]}
            </button>
          ))}
        </div>
        <DeviceButton menu="mic" {...deviceProps}>
          <button className={`icon${audio ? '' : ' off'}`} onClick={toggleAudio} aria-label={audio ? 'Mute' : 'Unmute'} title={audio ? 'Mute' : 'Unmute'}>
            {audio ? <MicIcon /> : <MicOffIcon />}
          </button>
        </DeviceButton>
        <DeviceButton menu="cam" {...deviceProps}>
          <button className={`icon${video ? '' : ' off'}`} onClick={toggleVideo} aria-label={video ? 'Camera off' : 'Camera on'} title={video ? 'Camera off' : 'Camera on'}>
            {video ? <VideoIcon /> : <VideoOffIcon />}
          </button>
        </DeviceButton>
        {float.kind && (
          <button
            className="icon"
            onClick={() => void (float.active ? float.exit() : float.enter())}
            aria-label={float.active ? 'Dock' : 'Float'}
            title={float.active ? 'Back to the full window' : 'Float the bubbles over other apps'}
          >
            {float.active ? <DockIcon /> : <FloatIcon />}
          </button>
        )}
        <button
          className="icon"
          aria-label={copied ? 'Link copied' : 'Copy room link'}
          title={copied ? 'Link copied' : 'Copy a link to this room'}
          onClick={() =>
            void copyText(roomLink(room, getServerUrl())).then((ok) => {
              setCopied(ok);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? <CheckIcon /> : <LinkIcon />}
        </button>
        <button
          className="icon leave"
          aria-label="Leave"
          title="Leave the call"
          onClick={() => {
            leave();
            location.assign('/');
          }}
        >
          <LeaveIcon />
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
