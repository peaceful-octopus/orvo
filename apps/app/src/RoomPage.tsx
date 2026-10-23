import { roomStatus } from '@chillcall/protocol';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bubble } from './Bubble';
import { useCall } from './callStore';
import { getServerUrl, giphyApiKey } from './config';
import { useConfig } from './configStore';
import { copyText, roomLink } from './roomInput';
import { SignInCard } from './auth/AccountUi';
import { useAuth } from './auth/authStore';
import { COPY, MEDIA_DENIED_MESSAGE } from './copy';
import { DeviceButton, DeviceSelects } from './DeviceMenu';
import { FilterButton } from './FilterMenu';
import { canSelectOutput } from './devices';
import { ReactionBar } from './ReactionBar';
import { SettingsButton } from './SettingsPane';
import { useSettings } from './settingsStore';
import { BubbleField, type Member, type ScreenShare } from './float/BubbleField';
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
  LockIcon,
  LockOpenIcon,
  MicIcon,
  MicOffIcon,
  RowIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  VideoIcon,
  VideoOffIcon,
} from './float/icons';
import { LAYOUT_MODES } from './float/layouts';
import { unreachableNotice } from './unreachable';
import { useUi } from './uiStore';
import type { DeviceKind, DeviceLists, DeviceSelection } from './devices';

const GifPicker = lazy(() => import('./GifPicker'));

const MODE_LABELS = { row: 'Row', column: 'Column', campfire: 'Campfire' } as const;
const MODE_ICONS = { row: <RowIcon />, column: <ColumnIcon />, campfire: <CampfireIcon /> } as const;

export function RoomPage({ room }: { room: string }) {
  const {
    phase,
    error,
    local,
    localDisplay,
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
    screen,
    shareScreen,
    stopScreen,
    loginRequired,
    roomAccess,
    setRoomAccess,
    leave,
  } = useCall();
  const accountName = useAuth((s) => s.session?.user.name ?? s.session?.user.email);
  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
  const outputs = canSelectOutput();
  const copyInvite = () =>
    copyText(roomLink(room, getServerUrl())).then((ok) => {
      setCopied(ok);
      setTimeout(() => setCopied(false), 2000);
    });
  const deviceProps = { devices, selected, canSelectOutput: outputs, onSelect: (kind: DeviceKind, id: string) => void selectDevice(kind, id) };
  const { mode, setMode } = useUi();
  const limits = useConfig((s) => s.config.limits);
  const apiKey = useConfig((s) => giphyApiKey(s.config));
  const [gifOpen, setGifOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const name = useSettings((s) => s.name);
  const setName = useSettings((s) => s.setName);
  const startView = useSettings((s) => s.startView);
  const moodFilter = useSettings((s) => s.moodFilter);
  const setMoodFilter = useSettings((s) => s.setMoodFilter);
  const blurBackground = useSettings((s) => s.blurBackground);
  const autoFrame = useSettings((s) => s.autoFrame);
  const setBlurBackground = useSettings((s) => s.setBlurBackground);
  const setAutoFrame = useSettings((s) => s.setAutoFrame);
  const look = { filter: moodFilter, blurBackground, autoFrame };
  const toggleLook = (which: 'blurBackground' | 'autoFrame', on: boolean) => (which === 'blurBackground' ? setBlurBackground(on) : setAutoFrame(on));

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

  const screens = useMemo<ScreenShare[]>(
    () => [
      ...(screen ? [{ id: 'self-screen', name, self: true }] : []),
      ...Object.values(remotes)
        .filter((p) => p.screen)
        .map((p) => ({ id: `${p.id}-screen`, name: p.name, stream: p.screen })),
    ],
    [screen, name, remotes],
  );

  // Someone who is signed in does not have to type their name: the account's is the starting point.
  useEffect(() => {
    if (!name && accountName) setName(accountName);
  }, [name, accountName, setName]);

  const float = useFloat(mode, members.length);

  // Calls open as floating bubbles when that is the chosen start view.
  const autoFloated = useRef(false);
  useEffect(() => {
    if (phase !== 'in-call') {
      autoFloated.current = false;
    } else if (!autoFloated.current && startView === 'floating' && float.kind) {
      autoFloated.current = true;
      void float.enter().catch(() => {}); // Picture-in-Picture can refuse without a fresh click
    }
  }, [phase, startView, float]);
  const onControlAction = (a: ControlAction) => {
    if (a.type === 'audio') toggleAudio();
    else if (a.type === 'video') toggleVideo();
    else if (a.type === 'react') void react(a.emoji);
    else if (a.type === 'gif') sendGif(a.source, a.mode).catch(() => {}); // the store already shows a message
    else if (a.type === 'device') void selectDevice(a.kind, a.id);
    else if (a.type === 'filter') setMoodFilter(a.id);
    else if (a.type === 'share') void (screen ? stopScreen() : shareScreen());
    else if (a.type === 'look') toggleLook(a.which, a.on);
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
    { audio, video, giphyKey: apiKey, devices, selected, canSelectOutput: outputs, ...look, sharing: Boolean(screen), canShare },
    onControlAction,
  );

  if (phase !== 'in-call') {
    return (
      <main>
        <SettingsButton />
        <div className="lobby">
          <div className="preview">
            <Bubble name={name} stream={local} videoOn={video} audioOn={audio} mirrored muteAudio />
          </div>
          <div className="lobby-form">
            <h1>Join {room}</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void join(room, name.trim());
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
              <button className="primary" disabled={!local || phase === 'joining'}>
                {phase === 'joining' ? 'Joining...' : 'Join'}
              </button>
            </form>
            {loginRequired === 'join' && <SignInCard title={COPY.account.roomForSignedIn.title} body={COPY.account.roomForSignedIn.body} />}
            {loginRequired === 'create' && <SignInCard title={COPY.account.needsLoginToStart.title} body={COPY.account.needsLoginToStart.body} />}
            {loginRequired === 'expired' && <SignInCard title={COPY.account.expired.title} body={COPY.account.expired.body} />}
            {error === MEDIA_DENIED_MESSAGE ? (
              <section className="state-card" role="alert">
                <h2>{COPY.mediaDenied.title}</h2>
                <p>{COPY.mediaDenied.body}</p>
                <ul>
                  {COPY.mediaDenied.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
                <div className="actions">
                  <button className="primary" onClick={() => void startPreview()}>
                    {COPY.mediaDenied.retry}
                  </button>
                </div>
              </section>
            ) : (
              error && (
                <section className="state-card" role="alert">
                  <p>{error}</p>
                  <div className="actions">
                    <button onClick={() => location.assign('/')}>{COPY.roomError.back}</button>
                  </div>
                </section>
              )
            )}
            <details className="devices">
              <summary>
                {COPY.devices}
                <span className="hint">{deviceSummary(devices, selected)}</span>
              </summary>
              <DeviceSelects {...deviceProps} />
            </details>
          </div>
        </div>
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
      <SettingsButton />
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
      <BubbleField members={members} mode={mode} screens={screens} onStopSharing={stopScreen} />
      {members.length === 1 && !screens.length && (
        <div className="alone">
          <p>{COPY.alone.text}</p>
          <button onClick={() => void copyInvite()}>{copied ? COPY.alone.copied : COPY.alone.copy}</button>
        </div>
      )}
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
        {roomAccess?.owner && (
          <button
            className={`icon${roomAccess.signedInOnly ? ' on' : ''}`}
            aria-label={COPY.account.onlySignedIn}
            aria-pressed={roomAccess.signedInOnly}
            title={roomAccess.signedInOnly ? 'Only signed-in people can join. Click to let guests in.' : 'Anyone with the link can join. Click to allow only signed-in people.'}
            onClick={() => void setRoomAccess(!roomAccess.signedInOnly)}
          >
            {roomAccess.signedInOnly ? <LockIcon /> : <LockOpenIcon />}
          </button>
        )}
        <FilterButton look={look} onFilter={setMoodFilter} onToggle={toggleLook} />
        {canShare && (
          <button
            className={`icon${screen ? ' on' : ''}`}
            aria-label={screen ? 'Stop sharing' : 'Share screen'}
            title={screen ? 'Stop sharing your screen' : 'Share your screen'}
            onClick={() => void (screen ? stopScreen() : shareScreen())}
          >
            {screen ? <ScreenShareOffIcon /> : <ScreenShareIcon />}
          </button>
        )}
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
          onClick={() => void copyInvite()}
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

/** The names of the chosen devices, for the collapsed Devices line in the lobby. */
function deviceSummary(devices: DeviceLists, selected: DeviceSelection): string {
  const label = (kind: DeviceKind) => devices[kind].find((o) => o.id === selected[kind])?.label ?? '';
  return [label('audioinput'), label('videoinput')].filter(Boolean).join(' · ');
}
