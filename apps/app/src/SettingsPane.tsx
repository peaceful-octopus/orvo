import { MAX_NAME_LENGTH } from '@chillcall/protocol';
import { useEffect, useState } from 'react';
import { useCall } from './callStore';
import { floatKind } from './float/float';
import { GearIcon } from './float/icons';
import { noiseSupported } from './noise';
import { useSettings, type StartView } from './settingsStore';

const START_VIEWS: { id: StartView; label: string }[] = [
  { id: 'windowed', label: 'Windowed' },
  { id: 'floating', label: 'Floating' },
];

const NOISE_STATUS = {
  off: '',
  loading: 'Loading the noise filter...',
  on: 'Noise filter running.',
  error: 'The noise filter could not start, so your microphone is used as it is.',
} as const;

function SettingsPane({ onClose }: { onClose(): void }) {
  const { name, startView, noise, setName, setStartView, setNoise } = useSettings();
  const noiseStatus = useCall((s) => s.noiseStatus);
  const canNoise = noiseSupported();
  const canFloat = floatKind() !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <label className="setting">
          <span className="setting-label">Your name</span>
          <input value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <span className="hint">Others see a change right away, even during a call.</span>
        </label>

        <div className="setting" role="group" aria-label="Start view">
          <span className="setting-label">Start calls as</span>
          <div className="segmented">
            {START_VIEWS.map((v) => (
              <button key={v.id} aria-pressed={startView === v.id} disabled={v.id === 'floating' && !canFloat} onClick={() => setStartView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          {!canFloat && <span className="hint">Floating bubbles are not available in this browser.</span>}
        </div>

        <div className="setting" role="group" aria-label="Noise suppression">
          <span className="setting-label">Background noise</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={noise.enabled && canNoise}
              disabled={!canNoise}
              onChange={(e) => setNoise({ enabled: e.target.checked })}
            />
            Reduce background noise and typing sounds
          </label>
          <label className="slider">
            Strength
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={noise.strength}
              disabled={!noise.enabled || !canNoise}
              aria-label="Noise suppression strength"
              onChange={(e) => setNoise({ strength: Number(e.target.value) })}
            />
            <output>{noise.strength}</output>
          </label>
          <span className="hint" role="status">
            {!canNoise ? 'This browser cannot run the noise filter.' : (NOISE_STATUS[noiseStatus] || 'Uses extra processing power. Turn it off on a slower computer.')}
          </span>
        </div>

        <div className="gif-footer">
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** The gear in the corner that opens Settings. */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon settings-gear" aria-label="Settings" title="Settings" onClick={() => setOpen(true)}>
        <GearIcon />
      </button>
      {open && <SettingsPane onClose={() => setOpen(false)} />}
    </>
  );
}
