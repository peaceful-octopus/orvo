import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminRequest, adminToken } from './adminApi';
import { buildChange, formFromView, isEmptyChange, serverErrors, withDefault, type FormState, type SettingKey, type SettingsView } from './adminLogic';
import { CLIENT_VERSION } from './config';
import { COPY } from './copy';
import { toast } from './toastStore';
import { Wordmark } from './Wordmark';

const A = COPY.admin;

type Phase =
  | { name: 'checking' }
  | { name: 'unreachable' }
  | { name: 'disabled' }
  | { name: 'local-only'; message?: string }
  | { name: 'login' }
  | { name: 'ready'; view: SettingsView };

/** Asks the server about the admin page, then opens it with a login still held for this tab, or asks for the password. */
async function open(): Promise<Phase> {
  try {
    const status = await adminRequest('GET', '/status');
    if (status.status === 404) return { name: 'disabled' };
    if (status.status === 403) return { name: 'local-only', message: (status.body as { error?: string } | undefined)?.error };
    if (status.status !== 200) return { name: 'unreachable' };
    const token = adminToken.get();
    if (!token) return { name: 'login' };
    const settings = await adminRequest('GET', '/settings', { token });
    if (settings.status === 200) return { name: 'ready', view: settings.body as SettingsView };
    adminToken.clear();
    return { name: 'login' };
  } catch {
    return { name: 'unreachable' };
  }
}

function Card({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <section className="state-card" role="status">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {children}
    </section>
  );
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (phase: Phase) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await adminRequest('POST', '/login', { body: { password } });
      if (res.status === 200) {
        adminToken.set((res.body as { token: string }).token);
        onLoggedIn(await open());
        return;
      }
      setError(res.status === 429 ? A.login.tooMany : res.status === 401 ? A.login.wrong : A.login.failed);
    } catch {
      setError(A.login.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="state-card"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>{A.login.title}</h2>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={A.login.password} aria-label={A.login.password} autoComplete="current-password" autoFocus />
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy || !password}>
          {A.login.submit}
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  view: SettingsView;
  setting: SettingKey;
  resets: ReadonlySet<SettingKey>;
  onReset(): void;
  children: ReactNode;
}

/** One setting: its control, what it means, where its value comes from, and a way back to the default. */
function Field({ id, label, hint, error, view, setting, resets, onReset, children }: FieldProps) {
  const saved = view.settings[setting].source === 'saved';
  const resetting = resets.has(setting);
  return (
    <div className="setting" role="group" aria-labelledby={`${id}-label`}>
      <span className="setting-label" id={`${id}-label`}>
        {label}
      </span>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <p className="error">{error}</p>}
      {(saved || resetting) && (
        <span className="hint">
          {resetting ? A.willReset : A.changedHere}
          {!resetting && (
            <>
              {' · '}
              <button type="button" className="link" onClick={onReset}>
                {A.reset}
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
}

function Settings({ view, onView, onLoggedOut }: { view: SettingsView; onView: (view: SettingsView) => void; onLoggedOut: () => void }) {
  const [form, setForm] = useState<FormState>(() => formFromView(view));
  const [resets, setResets] = useState<ReadonlySet<SettingKey>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [general, setGeneral] = useState<string>();
  const [saving, setSaving] = useState(false);

  const change = useMemo(() => buildChange(form, view, resets, CLIENT_VERSION), [form, view, resets]);
  const nothingToSave = isEmptyChange(change);

  const edit = (key: SettingKey, patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (resets.has(key)) {
      const next = new Set(resets);
      next.delete(key);
      setResets(next);
    }
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const reset = (key: SettingKey) => {
    setForm((f) => withDefault(f, view, key));
    setResets(new Set(resets).add(key));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const field = (key: SettingKey, id: string, label: string, hint: string | undefined, children: ReactNode) => (
    <Field id={id} label={label} hint={hint} error={errors[key]} view={view} setting={key} resets={resets} onReset={() => reset(key)}>
      {children}
    </Field>
  );
  const text = (key: 'maxRoomSize' | 'warnRoomSize' | 'minClientVersion' | 'announcement' | 'relayVideoKbps' | 'relayVideoScale' | 'relayVideoFps', id: string, extra: { numeric?: boolean; placeholder?: string } = {}) => (
    <input id={id} value={form[key]} inputMode={extra.numeric ? 'numeric' : undefined} placeholder={extra.placeholder} aria-labelledby={`${id}-label`} onChange={(e) => edit(key, { [key]: e.target.value })} />
  );
  const lines = (key: 'stunUrls' | 'turnUrls', id: string, placeholder: string) => (
    <textarea id={id} rows={3} value={form[key]} placeholder={placeholder} aria-labelledby={`${id}-label`} spellCheck={false} onChange={(e) => edit(key, { [key]: e.target.value })} />
  );
  const choice = (key: 'roomCreation' | 'defaultRoomAccess', labels: [string, string]) => (
    <div className="segmented">
      {(['anyone', 'signed-in'] as const).map((value, i) => (
        <button key={value} type="button" aria-pressed={form[key] === value} disabled={value === 'signed-in' && !view.authConfigured} onClick={() => edit(key, { [key]: value })}>
          {labels[i]}
        </button>
      ))}
    </div>
  );
  const secret = (key: 'turnSecret' | 'giphyApiKey', clearKey: 'clearTurnSecret' | 'clearGiphyApiKey', id: string) => {
    const isSet = view.settings[key].isSet;
    return (
      <>
        <input
          id={id}
          type="password"
          value={form[key]}
          placeholder={isSet ? A.secretSet : A.secretUnset}
          aria-labelledby={`${id}-label`}
          autoComplete="new-password"
          onChange={(e) => edit(key, { [key]: e.target.value, [clearKey]: false })}
        />
        {isSet && (
          <label className="toggle">
            <input type="checkbox" checked={form[clearKey]} onChange={(e) => edit(key, { [clearKey]: e.target.checked, [key]: '' })} />
            {A.secretClear}
          </label>
        )}
      </>
    );
  };

  const save = async () => {
    if (!change.ok) return setErrors(change.errors);
    setSaving(true);
    setErrors({});
    setGeneral(undefined);
    try {
      const res = await adminRequest('PATCH', '/settings', { token: adminToken.get(), body: { set: change.set, reset: change.reset } });
      if (res.status === 200) {
        const next = res.body as SettingsView;
        onView(next);
        setForm(formFromView(next));
        setResets(new Set());
        toast.info(A.saved);
      } else if (res.status === 401) {
        adminToken.clear();
        onLoggedOut();
      } else {
        const refused = serverErrors(res.body);
        setErrors(refused.fields);
        setGeneral(refused.general ?? A.saveFailed);
      }
    } catch {
      setGeneral(A.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="admin-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section>
        <h2>{A.sections.calls}</h2>
        {field('maxRoomSize', 'room-size', A.fields.maxRoomSize.label, A.fields.maxRoomSize.hint, text('maxRoomSize', 'room-size', { numeric: true }))}
        {field('warnRoomSize', 'warn-size', A.fields.warnRoomSize.label, A.fields.warnRoomSize.hint, text('warnRoomSize', 'warn-size', { numeric: true }))}
        {field('minClientVersion', 'min-version', A.fields.minClientVersion.label, A.fields.minClientVersion.hint(CLIENT_VERSION), text('minClientVersion', 'min-version', { placeholder: '0.0.0' }))}
        {field('announcement', 'announcement', A.fields.announcement.label, A.fields.announcement.hint, text('announcement', 'announcement'))}
        {field('roomCreation', 'room-creation', A.fields.roomCreation.label, view.authConfigured ? undefined : A.needsSignIn, choice('roomCreation', ['Anyone', 'Signed-in people only']))}
        {field('defaultRoomAccess', 'room-access', A.fields.defaultRoomAccess.label, view.authConfigured ? undefined : A.needsSignIn, choice('defaultRoomAccess', ['Anyone', 'Signed-in people only']))}
      </section>
      <section>
        <h2>{A.sections.network}</h2>
        {field('stunUrls', 'stun', A.fields.stunUrls.label, A.fields.stunUrls.hint, lines('stunUrls', 'stun', 'stun:stun.example.com:3478'))}
        {field('turnUrls', 'turn', A.fields.turnUrls.label, A.fields.turnUrls.hint, lines('turnUrls', 'turn', 'turn:turn.example.com:3478'))}
        {field('turnSecret', 'turn-secret', A.fields.turnSecret.label, A.fields.turnSecret.hint, secret('turnSecret', 'clearTurnSecret', 'turn-secret'))}
        {field('relayVideoKbps', 'relay-kbps', A.fields.relayVideoKbps.label, A.fields.relayVideoKbps.hint, text('relayVideoKbps', 'relay-kbps', { numeric: true, placeholder: '200' }))}
        {field('relayVideoScale', 'relay-scale', A.fields.relayVideoScale.label, A.fields.relayVideoScale.hint, text('relayVideoScale', 'relay-scale', { numeric: true, placeholder: '2' }))}
        {field('relayVideoFps', 'relay-fps', A.fields.relayVideoFps.label, A.fields.relayVideoFps.hint, text('relayVideoFps', 'relay-fps', { numeric: true, placeholder: '15' }))}
      </section>
      <section>
        <h2>{A.sections.integrations}</h2>
        {field('giphyApiKey', 'giphy', A.fields.giphyApiKey.label, A.fields.giphyApiKey.hint, secret('giphyApiKey', 'clearGiphyApiKey', 'giphy'))}
      </section>
      <p className="hint">{A.restartOnly}</p>
      {general && (
        <p className="error" role="alert">
          {general}
        </p>
      )}
      <div className="admin-actions">
        <button className="primary" disabled={saving || nothingToSave}>
          {saving ? A.saving : nothingToSave ? A.nothingToSave : A.save}
        </button>
      </div>
    </form>
  );
}

/** The operator's page for the server's settings, at /admin. It is not linked from anywhere else. */
export function AdminPage() {
  const [phase, setPhase] = useState<Phase>({ name: 'checking' });

  useEffect(() => {
    void open().then(setPhase);
  }, []);

  return (
    <main className="admin-page">
      <Wordmark className="wordmark-header" />
      <div className="admin">
        <h1>{A.title}</h1>
        {phase.name === 'checking' && <p className="hint">{A.checking}</p>}
        {phase.name === 'unreachable' && (
          <Card title={A.unreachable.title} body={A.unreachable.body}>
            <div className="actions">
              <button onClick={() => void open().then(setPhase)}>{A.unreachable.retry}</button>
            </div>
          </Card>
        )}
        {phase.name === 'disabled' && <Card title={A.disabled.title} body={A.disabled.body} />}
        {phase.name === 'local-only' && <Card title={A.localOnly.title} body={phase.message ?? A.localOnly.body} />}
        {phase.name === 'login' && <LoginForm onLoggedIn={setPhase} />}
        {phase.name === 'ready' && (
          <>
            <div className="admin-bar">
              <a href="/">{A.back}</a>
              <button
                className="link"
                onClick={() => {
                  adminToken.clear();
                  setPhase({ name: 'login' });
                }}
              >
                {A.logout}
              </button>
            </div>
            <Settings key={JSON.stringify(phase.view)} view={phase.view} onView={(view) => setPhase({ name: 'ready', view })} onLoggedOut={() => setPhase({ name: 'login' })} />
          </>
        )}
      </div>
    </main>
  );
}
