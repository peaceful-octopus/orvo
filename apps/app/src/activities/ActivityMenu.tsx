import { Popover, usePopover } from '../DeviceMenu';
import { COPY } from '../copy';
import { ActivityIcon } from '../float/icons';
import { ActivityPanel } from './ActivityPanel';
import { useActivity } from './activityStore';
import { useActivitySummary } from './useActivitySummary';

/** The button that starts or opens an activity. It is absent when the server offers none and none is running. */
export function ActivityMenu() {
  const { open, setOpen, ref } = usePopover();
  const { options, running } = useActivitySummary();
  if (!options.length && !running) return null;

  const { start, open: openRunning, close } = useActivity.getState();
  const act = (run: () => void) => () => {
    run();
    setOpen(false);
  };
  // A dot shows when someone has started something you have not opened.
  const invited = Boolean(running && !running.opened);

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
        <Popover>
          <ActivityPanel
            options={options}
            running={running}
            onStart={(id) => act(() => start(id))()}
            onOpen={act(openRunning)}
            onClose={act(close)}
          />
        </Popover>
      )}
    </div>
  );
}
