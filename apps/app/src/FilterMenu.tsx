import { MOOD_FILTERS, NO_FILTER } from '@chillcall/effects';
import { usePopover } from './DeviceMenu';
import { SparklesIcon } from './float/icons';

interface PanelProps {
  selected: string;
  onSelect(id: string): void;
}

/** The mood filters as a grid of swatches; the first is the plain camera. */
export function FilterPanel({ selected, onSelect }: PanelProps) {
  const options = [{ id: NO_FILTER, label: 'None', swatch: null }, ...MOOD_FILTERS];
  return (
    <div className="filter-menu" role="menu" aria-label="Filters">
      {options.map((f) => (
        <button key={f.id} role="menuitemradio" aria-checked={selected === f.id} onClick={() => onSelect(f.id)}>
          <span className="swatch" style={f.swatch ? { background: `linear-gradient(135deg, ${f.swatch[0]}, ${f.swatch[1]})` } : undefined} />
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** The filters button in the call bar. */
export function FilterButton({ selected, onSelect }: PanelProps) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="split" ref={ref}>
      <button
        className={`icon${selected !== NO_FILTER ? ' on' : ''}`}
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
          <FilterPanel selected={selected} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
