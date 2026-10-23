import { MOOD_FILTERS, NO_FILTER } from '@chillcall/effects';
import { usePopover } from './DeviceMenu';
import { SparklesIcon } from './float/icons';

export interface Look {
  filter: string;
  blurBackground: boolean;
  autoFrame: boolean;
}

interface PanelProps {
  look: Look;
  onFilter(id: string): void;
  onToggle(which: 'blurBackground' | 'autoFrame', on: boolean): void;
}

const TOGGLES = [
  { key: 'blurBackground', label: 'Blur background' },
  { key: 'autoFrame', label: 'Keep me in frame' },
] as const;

/** How your camera looks: a mood filter, background blur, and automatic framing. */
export function FilterPanel({ look, onFilter, onToggle }: PanelProps) {
  const options = [{ id: NO_FILTER, label: 'None', swatch: null }, ...MOOD_FILTERS];
  return (
    <div className="filter-menu" role="menu" aria-label="Filters">
      <div className="filter-grid" role="group" aria-label="Mood filter">
        {options.map((f) => (
          <button key={f.id} role="menuitemradio" aria-checked={look.filter === f.id} onClick={() => onFilter(f.id)}>
            <span className="swatch" style={f.swatch ? { background: `linear-gradient(135deg, ${f.swatch[0]}, ${f.swatch[1]})` } : undefined} />
            {f.label}
          </button>
        ))}
      </div>
      <div className="filter-toggles" role="group" aria-label="Camera">
        {TOGGLES.map(({ key, label }) => (
          <button key={key} role="menuitemcheckbox" aria-checked={look[key]} onClick={() => onToggle(key, !look[key])}>
            <span className="tick">{look[key] ? '\u2713' : ''}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** True when any of the camera looks is on, for lighting the button. */
export const lookIsOn = (look: Look) => look.filter !== NO_FILTER || look.blurBackground || look.autoFrame;

/** The filters button in the call bar. */
export function FilterButton(props: PanelProps) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="split" ref={ref}>
      <button
        className={`icon${lookIsOn(props.look) ? ' on' : ''}`}
        aria-label="Filters"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Filters"
        onClick={() => setOpen(!open)}
      >
        <SparklesIcon />
      </button>
      {open && (
        <div className="popover">
          <FilterPanel {...props} />
        </div>
      )}
    </div>
  );
}
