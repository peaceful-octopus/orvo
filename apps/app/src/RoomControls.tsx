import { useEffect } from 'react';
import { useAuthOffered } from './auth/AccountUi';
import { COPY } from './copy';
import { usePopover } from './DeviceMenu';
import { DoorClosedIcon, DoorOpenIcon } from './float/icons';

interface Access {
  signedInOnly: boolean;
  locked: boolean;
}

interface MenuProps {
  access: Access;
  onChange(patch: Partial<Access>): void;
}

/** For the room's owner: who may join. Shown in the call bar only to the person who made the room. */
export function RoomMenu({ access, onChange }: MenuProps) {
  const { open, setOpen, ref } = usePopover();
  const accountsOffered = useAuthOffered();
  const rows: { key: keyof Access; label: string; hint: string }[] = [
    { key: 'locked', label: COPY.room.lock.label, hint: COPY.room.lock.hint },
    ...(accountsOffered ? [{ key: 'signedInOnly' as const, label: COPY.account.onlySignedIn, hint: COPY.room.signedInHint }] : []),
  ];

  return (
    <div className="split" ref={ref}>
      <button
        className={`icon${access.locked || access.signedInOnly ? ' on' : ''}`}
        aria-label={COPY.room.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        title={COPY.room.menu}
        onClick={() => setOpen(!open)}
      >
        {access.locked ? <DoorClosedIcon /> : <DoorOpenIcon />}
      </button>
      {open && (
        <div className="popover">
          <div className="room-menu" role="menu" aria-label={COPY.room.menu}>
            {rows.map(({ key, label, hint }) => (
              <button key={key} role="menuitemcheckbox" aria-checked={access[key]} onClick={() => onChange({ [key]: !access[key] })}>
                <span className="tick">{access[key] ? '✓' : ''}</span>
                <span>
                  {label}
                  <span className="hint">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface KickProps {
  name: string;
  /** Whether the room is already locked; if not, removing and locking in one step is offered. */
  locked: boolean;
  onRemove(): void;
  onRemoveAndLock(): void;
  onCancel(): void;
}

/** Asks the owner to confirm removing someone, and offers to lock the room so they cannot just come back as someone new. */
export function KickDialog({ name, locked, onRemove, onRemoveAndLock, onCancel }: KickProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal kick-dialog" role="dialog" aria-modal="true" aria-label={COPY.room.kick.title(name)} onClick={(e) => e.stopPropagation()}>
        <h2>{COPY.room.kick.title(name)}</h2>
        <p className="hint">{locked ? COPY.room.kick.bodyLocked : COPY.room.kick.body}</p>
        <div className="actions">
          <button onClick={onCancel}>{COPY.room.kick.cancel}</button>
          <button className={locked ? 'primary' : undefined} onClick={onRemove}>
            {COPY.room.kick.remove}
          </button>
          {!locked && (
            <button className="primary" onClick={onRemoveAndLock}>
              {COPY.room.kick.removeAndLock}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
