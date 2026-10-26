import type { ReactNode } from 'react';
import { usePopover } from './DeviceMenu';
import { LayoutIcon } from './float/icons';
import type { LayoutMode } from './float/layouts';

const MODE_LABELS = { row: 'Row', column: 'Column', campfire: 'Campfire' } as const;

interface LayoutProps {
  modes: readonly LayoutMode[];
  mode: LayoutMode;
  icons: Record<LayoutMode, ReactNode>;
  onChange(mode: LayoutMode): void;
}

/** One drop-down for how the bubbles are arranged. */
export function LayoutMenu({ modes, mode, icons, onChange }: LayoutProps) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="split" ref={ref}>
      <button className="icon tool" aria-label="Layout" aria-haspopup="menu" aria-expanded={open} title="Layout" onClick={() => setOpen(!open)}>
        <LayoutIcon />
        <span>Layout</span>
      </button>
      {open && (
        <div className="popover">
          <div className="device-menu" role="menu" aria-label="Layout">
            {modes.map((m) => (
              <button
                key={m}
                role="menuitemradio"
                aria-checked={m === mode}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <span className="tick">{m === mode ? '✓' : ''}</span>
                {icons[m]}
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
