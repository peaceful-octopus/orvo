import { ACTIVITY_API_VERSION } from '@orvo/protocol';
import { useCall } from '../callStore';
import { useConfig } from '../configStore';
import { COPY } from '../copy';
import { usePopover } from '../DeviceMenu';
import { ActivityIcon } from '../float/icons';
import { openActivityInstance, useActivity } from './activityStore';

/** The button that starts or opens an activity. It is absent when the server offers none and none is running. */
export function ActivityMenu() {
  const { open, setOpen, ref } = usePopover();
  const manifests = useConfig((s) => s.config.activities)?.filter((m) => m.apiVersion === ACTIVITY_API_VERSION) ?? [];
  const current = useActivity((s) => s.room.current);
  const selfId = useActivity((s) => s.selfId);
  const opened = useActivity(openActivityInstance) !== undefined;
  const remotes = useCall((s) => s.remotes);
  if (!manifests.length && !current) return null;

  const running = current && manifests.find((m) => m.id === current.activityId);
  const starter = current?.starter === selfId ? null : (current && remotes[current.starter]?.name) || 'Guest';
  const { start, open: openRunning, close } = useActivity.getState();
  // A dot shows when someone has started something you have not opened.
  const invited = Boolean(current && !opened);

  return (
    <div className="split" ref={ref}>
      <button
        className="icon tool"
        aria-label={COPY.activities.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        title={COPY.activities.menu}
        onClick={() => setOpen(!open)}
      >
        <ActivityIcon />
        <span>{COPY.activities.label}</span>
        {invited && <i className="dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover">
          <div className="device-menu" role="menu" aria-label={COPY.activities.menu}>
            {current ? (
              <>
                <h3>{running ? COPY.activities.running(running.name, starter) : COPY.activities.unsupported}</h3>
                {!opened && running && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      openRunning();
                      setOpen(false);
                    }}
                  >
                    {COPY.activities.join}
                  </button>
                )}
                {(opened || current.starter === selfId) && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      close();
                      setOpen(false);
                    }}
                  >
                    {current.starter === selfId ? COPY.activities.end : COPY.activities.close}
                  </button>
                )}
              </>
            ) : (
              manifests.map((m) => (
                <button
                  key={m.id}
                  role="menuitem"
                  onClick={() => {
                    start(m.id);
                    setOpen(false);
                  }}
                >
                  <span className="tick">{m.icon ?? ''}</span>
                  <span>
                    {m.name}
                    <small className="hint">{m.description}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
