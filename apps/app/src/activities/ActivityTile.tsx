import { useLayoutEffect, useRef } from 'react';
import { useCall } from '../callStore';
import { COPY } from '../copy';
import { RemoveIcon } from '../float/icons';
import { onActivityData, useActivity } from './activityStore';
import { useActivityRun } from './useActivityRun';

/** The running activity in a sandboxed frame. The frame cannot reach the app; it only exchanges messages through the bridge. */
export function ActivityTile() {
  const remotes = useCall((s) => s.remotes);
  const { current, manifest, src, selfId, connect } = useActivityRun();
  const frame = useRef<HTMLIFrameElement>(null);

  useLayoutEffect(() => {
    if (!src) return;
    const link = connect((message) => frame.current?.contentWindow?.postMessage(message, '*')); // the frame has no origin of its own to name
    if (!link) return;
    const fromFrame = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow) link.bridge.fromFrame(event.data);
    };
    window.addEventListener('message', fromFrame);
    const stopData = onActivityData((from, message) => link.bridge.fromPeer(from, message));
    return () => {
      window.removeEventListener('message', fromFrame);
      stopData();
      link.disconnect();
    };
  }, [src, connect]);

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
        onClick={() => useActivity.getState().close()}
      >
        <RemoveIcon />
      </button>
    </figure>
  );
}
