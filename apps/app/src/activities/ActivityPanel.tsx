import { COPY } from '../copy';

/** An activity the server offers, as the menu lists it. */
export interface ActivityOption {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

/** The activity running in the call, as the menu describes it. */
export interface RunningActivity {
  /** Its name, or null when this version of Orvo cannot open it. */
  name: string | null;
  /** Who started it, or null when you did. */
  starter: string | null;
  /** Whether your frame is open. */
  opened: boolean;
}

interface Props {
  options: ActivityOption[];
  running?: RunningActivity;
  onStart(id: string): void;
  onOpen(): void;
  /** Closes your frame; as the starter it ends the activity for everyone. */
  onClose(): void;
}

/** Height the panel needs, for sizing a window around it. */
export function activityPanelHeight(options: ActivityOption[], running?: RunningActivity) {
  return 20 + (running ? 34 + (running.opened ? 1 : 2) * 36 : options.length * 56);
}

/** Starting an activity, or opening or closing the one that is running. */
export function ActivityPanel({ options, running, onStart, onOpen, onClose }: Props) {
  return (
    <div className="device-menu" role="menu" aria-label={COPY.activities.menu}>
      {running ? (
        <>
          <h3>{running.name ? COPY.activities.running(running.name, running.starter) : COPY.activities.unsupported}</h3>
          {!running.opened && running.name && (
            <button role="menuitem" onClick={onOpen}>
              {COPY.activities.join}
            </button>
          )}
          {(running.opened || running.starter === null) && (
            <button role="menuitem" onClick={onClose}>
              {running.starter === null ? COPY.activities.end : COPY.activities.close}
            </button>
          )}
        </>
      ) : (
        options.map((m) => (
          <button key={m.id} role="menuitem" onClick={() => onStart(m.id)}>
            <span className="tick">{m.icon ?? ''}</span>
            <span>
              {m.name}
              <small className="hint">{m.description}</small>
            </span>
          </button>
        ))
      )}
    </div>
  );
}
