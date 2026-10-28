import { ACTIVITY_API_VERSION, type ActivityParticipant } from '@orvo/protocol';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useCall } from '../callStore';
import { getServerUrl } from '../config';
import { useConfig } from '../configStore';
import { COPY } from '../copy';
import { RemoveIcon } from '../float/icons';
import { useSettings } from '../settingsStore';
import { ActivityBridge } from './activityBridge';
import { participantsOf } from './activityRoom';
import { onActivityData, useActivity } from './activityStore';

/** The app's theme colours, passed to the activity so it can match them. */
const THEME_VARS = ['--bg', '--surface', '--raised', '--hover', '--border', '--border-strong', '--text', '--muted', '--accent', '--accent-hover', '--on-accent', '--live', '--danger'];

function readTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) theme[name] = value;
  }
  return theme;
}

/** The running activity in a sandboxed frame. The frame cannot reach the app; it only exchanges messages through the bridge. */
export function ActivityTile() {
  const room = useActivity((s) => s.room);
  const selfId = useActivity((s) => s.selfId);
  const remotes = useCall((s) => s.remotes);
  const selfName = useSettings((s) => s.name);
  const manifests = useConfig((s) => s.config.activities);
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ActivityBridge | null>(null);

  const current = room.current;
  const manifest = current && manifests?.find((m) => m.id === current.activityId && m.apiVersion === ACTIVITY_API_VERSION);
  const src = useMemo(() => (manifest ? new URL(manifest.entry, getServerUrl()).href : undefined), [manifest]);

  // Everyone with the activity open, you included, with the names the call shows for them.
  const participants = useMemo<ActivityParticipant[]>(() => {
    if (!selfId) return [];
    const ids = new Set([...participantsOf(room), selfId]);
    return [...ids].sort().map((id) => ({ id, name: id === selfId ? selfName : remotes[id]?.name || 'Guest' }));
  }, [room, selfId, selfName, remotes]);
  const latest = useRef(participants);
  latest.current = participants;

  const instanceId = current?.instanceId;
  const host = current?.starter;
  useLayoutEffect(() => {
    if (!src || !instanceId || !host || !selfId) return;
    const self = latest.current.find((p) => p.id === selfId) ?? { id: selfId, name: selfName };
    const created = new ActivityBridge({
      instanceId,
      self,
      host,
      participants: latest.current,
      theme: readTheme(),
      post: (message) => frame.current?.contentWindow?.postMessage(message, '*'), // the frame has no origin of its own to name
      send: (message) => useCall.getState().sendData(message),
      onReady: () => useActivity.getState().announce(true),
      onEnd: () => useActivity.getState().close(),
    });
    bridge.current = created;
    const fromFrame = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow) created.fromFrame(event.data);
    };
    window.addEventListener('message', fromFrame);
    const stopData = onActivityData((from, message) => created.fromPeer(from, message));
    return () => {
      window.removeEventListener('message', fromFrame);
      stopData();
      created.close();
      bridge.current = null;
      // The frame is going away (closed, ended, or the window changed shape): the others should stop counting it.
      useActivity.getState().announce(false);
    };
    // selfName is read once; later renames reach the activity through the participant list.
  }, [src, instanceId, host, selfId]);

  useLayoutEffect(() => {
    bridge.current?.setParticipants(participants);
  }, [participants]);

  if (!current) return null;
  const starter = current.starter === selfId ? null : remotes[current.starter]?.name || 'Guest';

  return (
    <figure className="activity-tile">
      {src ? (
        <iframe
          ref={frame}
          src={src}
          title={manifest?.name}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          onLoad={() => frame.current?.focus()}
        />
      ) : (
        <p className="activity-unsupported">{COPY.activities.unsupported}</p>
      )}
      <figcaption>{manifest ? (starter ? COPY.activities.startedBy(manifest.name, starter) : manifest.name) : current.activityId}</figcaption>
      <button
        className="icon activity-close"
        aria-label={current.starter === selfId ? COPY.activities.end : COPY.activities.close}
        title={current.starter === selfId ? COPY.activities.end : COPY.activities.close}
        onMouseDown={(e) => e.stopPropagation()} // the floating window drags by its content; the button must still click
        onClick={() => useActivity.getState().close()}
      >
        <RemoveIcon />
      </button>
    </figure>
  );
}
