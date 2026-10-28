import { roomStatus } from '@orvo/protocol';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Bubble } from './Bubble';
import { useCall } from './callStore';
import { getServerUrl, giphyApiKey } from './config';
import { useConfig } from './configStore';
import { copyText, roomLink } from './roomInput';
import { SignInCard } from './auth/AccountUi';
import { KickDialog, RoomMenu } from './RoomControls';
import { useAuth } from './auth/authStore';
import { COPY, MEDIA_DENIED_MESSAGE } from './copy';
import { DeviceButton, DeviceSelects } from './DeviceMenu';
import { LayoutMenu } from './BarMenus';
import { ActivityMenu } from './activities/ActivityMenu';
import { ActivityRelay } from './activities/ActivityRelay';
import { ActivityTile } from './activities/ActivityTile';
import { useActivitySummary } from './activities/useActivitySummary';
import { openActivityInstance, useActivity } from './activities/activityStore';
import { FilterButton } from './FilterMenu';
import { canSelectOutput } from './devices';
import { ReactionBar } from './ReactionBar';
import { SettingsButton } from './SettingsPane';
import { useSettings } from './settingsStore';
import { BubbleField, type Member, type ScreenShare } from './float/BubbleField';
import type { ControlAction } from './float/bridge';
import { closeControlsWindow, useControlsWindow } from './float/controlsWindow';
import { FloatView } from './float/FloatView';
import { useFloat } from './float/float';
import {
  BackIcon,
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
  ScreenShareIcon,
  ScreenShareOffIcon,
  VideoIcon,
  VideoOffIcon,
} from './float/icons';
import { LAYOUT_MODES, UNCAPPED } from './float/layouts';
import { Wordmark } from './Wordmark';
import { unreachableNotice } from './unreachable';
import { useUi } from './uiStore';
import type { DeviceKind, DeviceLists, DeviceSelection } from './devices';

const GifPicker = lazy(() => import('./GifPicker'));

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
    blocked,
    kick,
    leave,
  } = useCall();
  const [kicking, setKicking] = useState<{ id: string; name: string } | null>(null);
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
  const activityInstance = useActivity(openActivityInstance);
  const activitySummary = useActivitySummary();
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

  const tiles = useMemo(() => (activityInstance ? [{ id: activityInstance, node: <ActivityTile /> }] : []), [activityInstance]);

  // Once signed in, the sign-in card has done its job.
  useEffect(() => {
    if (accountName) useCall.setState({ loginRequired: undefined });
  }, [accountName]);

  // Someone who is signed in does not have to type their name: the account's is the starting point.
  useEffect(() => {
    if (!name && accountName) setName(accountName);
  }, [name, accountName, setName]);

  const float = useFloat(mode, members.length);

  // If the call ends while the window is small (for instance the owner removed you), the full window comes back.
  const { active: floating, exit: exitFloat } = float;
  useEffect(() => {
    if (phase !== 'in-call' && floating) void exitFloat();
  }, [phase, floating, exitFloat]);

  // Calls open as floating bubbles when that is the chosen start view.
  const autoFloated = useRef(false);
  useEffect(() => {
    if (phase !== 'in-call') {
      autoFloated.current = false;
    } else if (!autoFloated.current && startView === 'floating' && float.kind) {
      autoFloated.current = true;
      void float.enter().catch(() => {}); // the window may refuse while the call is still starting
    }
  }, [phase, startView, float]);
  const onControlAction = (a: ControlAction) => {
    if (a.type === 'audio') toggleAudio();
    else if (a.type === 'video') toggleVideo();
    else if (a.type === 'react') void react(a.emoji);
    else if (a.type === 'gif') sendGif(a.source, a.mode).catch(() => {}); // the store already shows a message
    else if (a.type === 'device') void selectDevice(a.kind, a.id);
    else if (a.type === 'filter') setMoodFilter(a.id);
    else if (a.type === 'share') void (screen ? stopScreen() : float.withRoomyWindow(shareScreen));
    else if (a.type === 'look') toggleLook(a.which, a.on);
    else if (a.type === 'activity-start') useActivity.getState().start(a.id);
    else if (a.type === 'activity-open') useActivity.getState().open();
    else if (a.type === 'activity-close') useActivity.getState().close();
    else if (a.type === 'leave') void leaveCall();
    else void float.exit();
  };
  const leaveCall = async () => {
    await float.exit(); // restore the full window before the page reloads
    await closeControlsWindow().catch(() => {}); // the reload would otherwise cut its closing short and leave the bar behind
    leave();
    location.assign('/');
  };
  const controlsWindow = useControlsWindow(
    float.active && float.kind === 'tauri',
    { audio, video, giphyKey: apiKey, devices, selected, canSelectOutput: outputs, ...look, sharing: Boolean(screen), canShare, activities: activitySummary.options, activity: activitySummary.running },
    onControlAction,
  );

  if (phase !== 'in-call') {
    return (
      <main>
        <SettingsButton />
        <div className="header-left">
          <button className="icon" aria-label="Back" title="Back to the start page" onClick={() => location.assign('/')}>
            <BackIcon />
          </button>
          <Wordmark className="wordmark-header" />
        </div>
        <div className="lobby">
          <div className="lobby-preview">
            <div className="preview">
              <Bubble name={name} stream={local} videoOn={video} audioOn={audio} mirrored muteAudio />
            </div>
            <div className="lobby-toggles">
              <button className={`icon${audio ? '' : ' off'}`} onClick={toggleAudio} aria-label={audio ? 'Mute' : 'Unmute'} title={audio ? 'Mute' : 'Unmute'}>
                {audio ? <MicIcon /> : <MicOffIcon />}
              </button>
              <button className={`icon${video ? '' : ' off'}`} onClick={toggleVideo} aria-label={video ? 'Camera off' : 'Camera on'} title={video ? 'Camera off' : 'Camera on'}>
                {video ? <VideoIcon /> : <VideoOffIcon />}
              </button>
              <FilterButton look={look} onFilter={setMoodFilter} onToggle={toggleLook} />
            </div>
          </div>
          <div className="lobby-form">
            <div className="lobby-title">
              <h1>Ready to join?</h1>
              <p>
                Room: <strong>{room}</strong>
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void join(room, name.trim());
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
              <button className="primary big" disabled={!local || phase === 'joining'}>
                {phase === 'joining' ? 'Joining...' : 'Join'}
              </button>
            </form>
            {blocked === 'locked' && (
              <section className="state-card" role="alert">
                <h2>{COPY.room.locked.title}</h2>
                <p>{COPY.room.locked.body}</p>
                <div className="actions">
                  <button onClick={() => location.assign('/')}>{COPY.room.backHome}</button>
                </div>
              </section>
            )}
            {blocked === 'kicked' && (
              <section className="state-card" role="alert">
                <h2>{COPY.room.kicked.title}</h2>
                <p>{COPY.room.kicked.body}</p>
                <div className="actions">
                  <button onClick={() => location.assign('/')}>{COPY.room.backHome}</button>
                </div>
              </section>
            )}
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
  if (float.active && float.kind === 'tauri') {
    return (
      <>
        {floatView(true)}
        {activityInstance && <ActivityRelay />}
      </>
    );
  }

  const status = roomStatus(members.length, limits);
  const notice = unreachableNotice(members.filter((m) => m.unreachable).map((m) => m.name));

  return (
    <main className="call">
      <Wordmark className="wordmark-corner" />
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
      <BubbleField
        members={members}
        mode={mode}
        maxSize={UNCAPPED}
        screens={screens}
        tiles={tiles}
        onStopSharing={stopScreen}
        onKick={roomAccess?.owner ? (id, who) => setKicking({ id, name: who }) : undefined}
      />
      {members.length === 1 && !screens.length && !tiles.length && (
        <div className="alone">
          <p>{COPY.alone.text}</p>
          <button onClick={() => void copyInvite()}>{copied ? COPY.alone.copied : COPY.alone.copy}</button>
        </div>
      )}
      <ReactionBar disabled={!video} onReact={(emoji) => void react(emoji)} onGif={apiKey ? () => setGifOpen(true) : undefined} />
      <nav className="controls">
        <FilterButton labelled look={look} onFilter={setMoodFilter} onToggle={toggleLook} />
        <LayoutMenu modes={LAYOUT_MODES} mode={mode} icons={MODE_ICONS} onChange={setMode} />
        <ActivityMenu />
        {float.kind && (
          <button
            className="icon tool"
            onClick={() => void (float.active ? float.exit() : float.enter())}
            aria-label={float.active ? 'Dock' : 'Float'}
            title={float.active ? 'Back to the full window' : 'Float the bubbles over other apps'}
          >
            {float.active ? <DockIcon /> : <FloatIcon />}
            <span>{float.active ? 'Dock' : 'Float'}</span>
          </button>
        )}
        <div className="sep" aria-hidden="true" />
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
        <div className="sep" aria-hidden="true" />
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
        {roomAccess?.owner && <RoomMenu access={roomAccess} onChange={(patch) => void setRoomAccess(patch)} />}
        <button
          className="icon"
          aria-label={copied ? 'Link copied' : 'Copy room link'}
          title={copied ? 'Link copied' : 'Copy a link to this room'}
          onClick={() => void copyInvite()}
        >
          {copied ? <CheckIcon /> : <LinkIcon />}
        </button>
      </nav>
      {kicking && (
        <KickDialog
          name={kicking.name}
          locked={Boolean(roomAccess?.locked)}
          onCancel={() => setKicking(null)}
          onRemove={() => {
            kick(kicking.id);
            setKicking(null);
          }}
          onRemoveAndLock={() => {
            kick(kicking.id);
            void setRoomAccess({ locked: true });
            setKicking(null);
          }}
        />
      )}
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
    </main>
  );
}

/** The names of the chosen devices, for the collapsed Devices line in the lobby. */
function deviceSummary(devices: DeviceLists, selected: DeviceSelection): string {
  const label = (kind: DeviceKind) => devices[kind].find((o) => o.id === selected[kind])?.label ?? '';
  return [label('audioinput'), label('videoinput')].filter(Boolean).join(' · ');
}
