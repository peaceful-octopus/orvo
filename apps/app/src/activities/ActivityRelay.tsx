import { useEffect, useRef } from 'react';
import { useCall } from '../callStore';
import { COPY } from '../copy';
import { closeActivityWindow, openActivityWindow } from '../float/activityWindows';
import {
  EVT_ACTIVITY_CLOSE,
  EVT_ACTIVITY_FROM_FRAME,
  EVT_ACTIVITY_INFO,
  EVT_ACTIVITY_READY,
  EVT_ACTIVITY_TO_FRAME,
  type ActivityWindowInfo,
} from '../float/bridge';
import { onActivityData, useActivity } from './activityStore';
import { useActivityRun } from './useActivityRun';

/**
 * While the call is floating, the activity runs in a window of its own and this connects it to the call. The bridge
 * stays here, so everything the frame sends is checked in the call window; the activity window only carries messages
 * between its frame and this one.
 */
export function ActivityRelay() {
  const remotes = useCall((s) => s.remotes);
  const { current, manifest, src, selfId, connect } = useActivityRun();

  const starter = current && current.starter !== selfId ? remotes[current.starter]?.name || 'Guest' : null;
  const mine = current?.starter === selfId;
  const info = useRef<ActivityWindowInfo | undefined>(undefined);
  info.current =
    src && manifest
      ? {
          src,
          title: manifest.name,
          caption: starter ? COPY.activities.startedBy(manifest.name, starter) : manifest.name,
          closeLabel: mine ? COPY.activities.end : COPY.activities.close,
        }
      : undefined;

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    let cleanup = () => {};
    void (async () => {
      const { emit, listen } = await import('@tauri-apps/api/event');
      if (cancelled) return;
      const link = connect((message) => void emit(EVT_ACTIVITY_TO_FRAME, message));
      if (!link) return;
      // Listen before the window exists, so nothing the frame says first is missed.
      const subscriptions = await Promise.all([
        listen(EVT_ACTIVITY_READY, () => info.current && void emit(EVT_ACTIVITY_INFO, info.current)),
        listen<unknown>(EVT_ACTIVITY_FROM_FRAME, (e) => link.bridge.fromFrame(e.payload)),
        listen(EVT_ACTIVITY_CLOSE, () => useActivity.getState().close()),
      ]);
      const stopData = onActivityData((from, message) => link.bridge.fromPeer(from, message));
      cleanup = () => {
        subscriptions.forEach((u) => u());
        stopData();
        link.disconnect();
        void closeActivityWindow();
      };
      if (cancelled) return cleanup();
      await openActivityWindow();
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [src, connect]);

  return null;
}
