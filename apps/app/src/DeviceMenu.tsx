import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type DeviceKind, type DeviceLists, type DeviceSelection } from './devices';

export type MenuKind = 'mic' | 'cam';

const SECTIONS: Record<MenuKind, { kind: DeviceKind; title: string }[]> = {
  mic: [
    { kind: 'audioinput', title: 'Microphone' },
    { kind: 'audiooutput', title: 'Speaker' },
  ],
  cam: [{ kind: 'videoinput', title: 'Camera' }],
};

interface PanelProps {
  menu: MenuKind;
  devices: DeviceLists;
  selected: DeviceSelection;
  /** False in browsers that cannot choose a speaker. */
  canSelectOutput: boolean;
  onSelect(kind: DeviceKind, id: string): void;
}

/** Number of rows a menu shows, for sizing a window around it. */
export function menuRows(menu: MenuKind, devices: DeviceLists, canSelectOutput: boolean) {
  const sections = SECTIONS[menu].filter((s) => s.kind !== 'audiooutput' || canSelectOutput);
  return { sections: sections.length, options: sections.reduce((n, s) => n + devices[s.kind].length, 0) };
}

/** The device choices for the microphone button (microphone and speaker) or the camera button (camera). */
export function DeviceMenuPanel({ menu, devices, selected, canSelectOutput, onSelect }: PanelProps) {
  return (
    <div className="device-menu" role="menu" aria-label={menu === 'mic' ? 'Audio devices' : 'Camera'}>
      {SECTIONS[menu]
        .filter((s) => s.kind !== 'audiooutput' || canSelectOutput)
        .map(({ kind, title }) => (
          <div key={kind} role="group" aria-label={title}>
            <h3>{title}</h3>
            {devices[kind].map((o) => (
              <button
                key={o.id || 'default'}
                role="menuitemradio"
                aria-checked={selected[kind] === o.id}
                onClick={() => onSelect(kind, o.id)}
              >
                <span className="tick">{selected[kind] === o.id ? '✓' : ''}</span>
                {o.label}
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}

interface ButtonProps extends Omit<PanelProps, 'menu'> {
  menu: MenuKind;
  /** The mute or camera button this menu belongs to. */
  children: ReactNode;
}

/** A button with a small arrow beside it that opens the list of devices. */
export function DeviceButton({ menu, children, ...panel }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="split" ref={ref}>
      {children}
      <button
        className="chevron"
        aria-label={menu === 'mic' ? 'Microphone options' : 'Camera options'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ▾
      </button>
      {open && (
        <div className="popover">
          <DeviceMenuPanel menu={menu} {...panel} />
        </div>
      )}
    </div>
  );
}

/** Plain drop-downs for the lobby, where there are no call buttons yet. */
export function DeviceSelects({ devices, selected, canSelectOutput, onSelect }: Omit<PanelProps, 'menu'>) {
  const rows: [DeviceKind, string][] = [
    ['audioinput', 'Microphone'],
    ['videoinput', 'Camera'],
    ...(canSelectOutput ? ([['audiooutput', 'Speaker']] as [DeviceKind, string][]) : []),
  ];
  return (
    <div className="device-selects">
      {rows.map(([kind, title]) => (
        <label key={kind}>
          {title}
          <select aria-label={title} value={selected[kind]} onChange={(e) => onSelect(kind, e.target.value)}>
            {devices[kind].map((o) => (
              <option key={o.id || 'default'} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
