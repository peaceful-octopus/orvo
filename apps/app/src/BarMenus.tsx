import type { ReactNode } from 'react';
import { usePopover } from './DeviceMenu';
import { CheckIcon, DockIcon, FloatIcon, LayoutIcon, LinkIcon, MoreIcon } from './float/icons';
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

interface MoreProps {
  copied: boolean;
  onCopy(): void;
  /** Present where the app can float its bubbles over other windows. */
  float?: { active: boolean; toggle(): void };
}

/** Less-used actions: floating the bubbles and copying the room link. */
export function MoreMenu({ copied, onCopy, float }: MoreProps) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="split" ref={ref}>
      <button className="icon tool" aria-label="More" aria-haspopup="menu" aria-expanded={open} title="More" onClick={() => setOpen(!open)}>
        <MoreIcon />
        <span>More</span>
      </button>
      {open && (
        <div className="popover">
          <div className="device-menu" role="menu" aria-label="More">
            {float && (
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  float.toggle();
                }}
              >
                {float.active ? <DockIcon /> : <FloatIcon />}
                {float.active ? 'Dock' : 'Float'}
              </button>
            )}
            <button role="menuitem" onClick={onCopy}>
              {copied ? <CheckIcon /> : <LinkIcon />}
              {copied ? 'Link copied' : 'Copy room link'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
