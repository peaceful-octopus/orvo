import { ACTIVITY_API_VERSION, type ActivityHostMessage, type ActivityParticipant } from '@orvo/protocol';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useCall } from '../callStore';
import { getServerUrl } from '../config';
import { useConfig } from '../configStore';
import { useSettings } from '../settingsStore';
import { ActivityBridge } from './activityBridge';
import { participantsOf } from './activityRoom';
import { useActivity } from './activityStore';

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

/**
 * The running activity, for whatever shows its frame: the address to load, and a bridge that connects that frame to
 * the call. The bridge keeps the frame's list of participants current.
 */
export function useActivityRun() {
  const room = useActivity((s) => s.room);
  const selfId = useActivity((s) => s.selfId);
  const remotes = useCall((s) => s.remotes);
  const selfName = useSettings((s) => s.name);
  const manifests = useConfig((s) => s.config.activities);

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

  const bridge = useRef<ActivityBridge | null>(null);
  useLayoutEffect(() => {
    bridge.current?.setParticipants(participants);
  }, [participants]);

  const instanceId = current?.instanceId;
  const host = current?.starter;
  /** Creates the bridge for a new frame. `post` delivers a message to it; pass what it sends to `fromFrame`. */
  const connect = useCallback(
    (post: (message: ActivityHostMessage) => void) => {
      if (!instanceId || !host || !selfId) return undefined;
      const self = latest.current.find((p) => p.id === selfId) ?? { id: selfId, name: useSettings.getState().name };
      const created = new ActivityBridge({
        instanceId,
        self,
        host,
        participants: latest.current,
        theme: readTheme(),
        post,
        send: (message) => useCall.getState().sendData(message),
        onReady: () => useActivity.getState().announce(true),
        onEnd: () => useActivity.getState().close(),
      });
      bridge.current = created;
      return {
        bridge: created,
        /** The frame is going away (closed, ended, or the window changed shape): the others should stop counting it. */
        disconnect() {
          created.close();
          if (bridge.current === created) bridge.current = null;
          useActivity.getState().announce(false);
        },
      };
    },
    [instanceId, host, selfId],
  );

  return { current, manifest, src, selfId, instanceId, host, connect };
}
