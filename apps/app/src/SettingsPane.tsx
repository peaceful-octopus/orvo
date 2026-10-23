import { MAX_NAME_LENGTH } from '@chillcall/protocol';
import { useEffect, useState, type CSSProperties } from 'react';
import { AccountButton, AccountSection } from './auth/AccountUi';
import { useCall } from './callStore';
import { defaultServerUrl, getServerUrl, giphyApiKey, setServerUrl, setTelemetryAllowed, telemetryAllowed } from './config';
import { useConfig } from './configStore';
import { floatKind } from './float/float';
import { GearIcon } from './float/icons';
import { noiseSupported } from './noise';
import { MAX_MIC_VOLUME, useSettings, type StartView } from './settingsStore';
import { setTelemetryEnabled } from './telemetry';
import { PALETTES } from './theme/palettes';
import type { ModePreference } from './theme/theme';

const START_VIEWS: { id: StartView; label: string }[] = [
  { id: 'windowed', label: 'Windowed' },
  { id: 'floating', label: 'Floating' },
];

const MODES: { id: ModePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const NOISE_STATUS = {
  off: '',
  loading: 'Loading the noise filter...',
  on: 'Noise filter running.',
  error: 'The noise filter could not start, so your microphone is used as it is.',
} as const;

interface SliderProps {
  label: string;
  'aria-label': string;
  value: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  /** A value to mark on the track, such as 100% on a slider that goes to 200%. */
  marker?: number;
  onChange(value: number): void;
}

/** A labelled range slider whose track fills up to the current value. */
function Slider({ label, value, max, step, unit = '', disabled, marker, onChange, ...rest }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={rest['aria-label']}
        style={{ '--fill': `${(value / max) * 100}%`, '--marker': marker === undefined ? '-100%' : `${(marker / max) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>
        {value}
        {unit}
      </output>
    </label>
  );
}

/** The server this app talks to, and what it shares with it. Rarely changed, so it sits at the bottom. */
function Advanced() {
  const [server, setServer] = useState(getServerUrl());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [shareStats, setShareStats] = useState(telemetryAllowed());
  const gifsOn = useConfig((s) => Boolean(giphyApiKey(s.config)));

  return (
    <details className="setting advanced">
      <summary>Advanced</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const ok = setServerUrl(server);
          setSaved(ok);
          setError(ok ? undefined : 'That is not a valid server address.');
          if (ok) {
            setServer(getServerUrl());
            void useConfig.getState().refresh();
          }
        }}
      >
        <input
          value={server}
          onChange={(e) => {
            setServer(e.target.value);
            setSaved(false);
          }}
          placeholder={defaultServerUrl()}
          aria-label="Server address"
        />
        <button>{saved ? 'Saved' : 'Save'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="hint">Server address. Leave empty to use the default ({defaultServerUrl()}).</p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={shareStats}
          onChange={(e) => {
            setShareStats(e.target.checked);
            setTelemetryAllowed(e.target.checked);
            setTelemetryEnabled(e.target.checked);
          }}
        />
        Share anonymous connection statistics with this server
      </label>
      <p className="hint">Whether calls connect directly, and how fast. No names, rooms or addresses.</p>
      {gifsOn && <p className="hint">GIF search is provided by GIPHY: the terms you search for, and your address, are sent to them directly.</p>}
    </details>
  );
}

function SettingsPane({ onClose }: { onClose(): void }) {
  const { name, startView, mode, palette, noise, micVolume, speakerVolume } = useSettings();
  const { setName, setStartView, setMode, setPalette, setNoise, setMicVolume, setSpeakerVolume } = useSettings();
  const noiseStatus = useCall((s) => s.noiseStatus);
  const canNoise = noiseSupported();
  const canFloat = floatKind() !== null;
  const palettes = Object.entries(PALETTES);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <AccountSection />

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

        <div className="setting" role="group" aria-label="Appearance">
          <span className="setting-label">Appearance</span>
          <div className="segmented" role="group" aria-label="Light or dark">
            {MODES.map((m) => (
              <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          {palettes.length > 1 && (
            <label className="palette">
              <span className="hint">Colours</span>
              <select aria-label="Colour palette" value={palette} onChange={(e) => setPalette(e.target.value)}>
                {palettes.map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="setting" role="group" aria-label="Volume">
          <span className="setting-label">Volume</span>
          <Slider
            label="Microphone"
            aria-label="Microphone volume"
            value={micVolume}
            max={MAX_MIC_VOLUME}
            step={5}
            unit="%"
            marker={100}
            onChange={setMicVolume}
          />
          <Slider
            label="Speaker"
            aria-label="Speaker volume"
            value={speakerVolume}
            max={100}
            step={5}
            unit="%"
            onChange={setSpeakerVolume}
          />
          <span className="hint">Microphone volume above 100% makes you louder and can distort.</span>
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
          <Slider
            label="Strength"
            aria-label="Noise suppression strength"
            value={noise.strength}
            max={100}
            step={5}
            disabled={!noise.enabled || !canNoise}
            onChange={(strength) => setNoise({ strength })}
          />
          <span className="hint" role="status">
            {!canNoise ? 'This browser cannot run the noise filter.' : (NOISE_STATUS[noiseStatus] || 'Uses extra processing power. Turn it off on a slower computer.')}
          </span>
        </div>

        <Advanced />

        <div className="gif-footer">
          <span />
          <button className="primary" onClick={onClose}>
            Done
          </button>
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
      <div className="corner">
        <AccountButton onOpenSettings={() => setOpen(true)} />
        <button className="icon" aria-label="Settings" title="Settings" onClick={() => setOpen(true)}>
          <GearIcon />
        </button>
      </div>
      {open && <SettingsPane onClose={() => setOpen(false)} />}
    </>
  );
}
