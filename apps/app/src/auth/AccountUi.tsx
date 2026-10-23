import { useEffect, useState } from 'react';
import { COPY } from '../copy';
import { useConfig } from '../configStore';
import { toast } from '../toastStore';
import { useAuth } from './authStore';

/** Starts sign-in, telling the person if the provider cannot be reached. */
export function useSignIn() {
  const signIn = useAuth((s) => s.signIn);
  return () => {
    // On the desktop the browser opens separately, so say where to look.
    if ('__TAURI_INTERNALS__' in window) toast.info(COPY.account.waiting);
    void signIn().catch((err: unknown) => toast.error(err instanceof Error && err.message && !/fetch|network/i.test(err.message) ? err.message : COPY.toasts.signInFailed));
  };
}

/** Whether this server lets people sign in at all; when it does not, no sign-in appears anywhere. */
export const useAuthOffered = () => useConfig((s) => Boolean(s.config.auth));

/** The name of whoever is signed in, for showing it. */
export function accountName(user: { name?: string; email?: string } | undefined) {
  return user?.name || user?.email || 'you';
}

/** In the corner of the page: a Sign in button for guests, and the person's initial once they are signed in. */
export function AccountButton({ onOpenSettings }: { onOpenSettings(): void }) {
  const offered = useAuthOffered();
  const user = useAuth((s) => s.session?.user);
  const waiting = useAuth((s) => s.waiting);
  const signIn = useSignIn();
  if (!offered) return null;
  if (!user) {
    return (
      <button onClick={signIn} disabled={waiting}>
        {waiting ? COPY.account.waiting : COPY.account.signIn}
      </button>
    );
  }
  const name = accountName(user);
  return (
    <button className="icon account" aria-label={`${COPY.account.signedInAs} ${name}`} title={`${COPY.account.signedInAs} ${name}`} onClick={onOpenSettings}>
      {name[0]!.toUpperCase()}
    </button>
  );
}

/** The Account part of Settings. */
export function AccountSection() {
  const offered = useAuthOffered();
  const user = useAuth((s) => s.session?.user);
  const signOut = useAuth((s) => s.signOut);
  const signIn = useSignIn();
  if (!offered) return null;
  return (
    <div className="setting" role="group" aria-label="Account">
      <span className="setting-label">Account</span>
      {user ? (
        <>
          <p className="account-line">
            {COPY.account.signedInAs} <strong>{accountName(user)}</strong>
            {user.email && user.name ? <span className="hint"> ({user.email})</span> : null}
          </p>
          <div>
            <button onClick={signOut}>{COPY.account.signOut}</button>
          </div>
        </>
      ) : (
        <>
          <span className="hint">{COPY.account.guestsHint}</span>
          <div>
            <button className="primary" onClick={signIn}>
              {COPY.account.signIn}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** A message with a Sign in button, for when the server needs the person to sign in before going on. */
export function SignInCard({ title, body }: { title: string; body: string }) {
  const signIn = useSignIn();
  return (
    <section className="state-card" role="alert">
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="actions">
        <button className="primary" onClick={signIn}>
          {COPY.account.signIn}
        </button>
      </div>
    </section>
  );
}

let finishing: Promise<string> | undefined;

/** Where the provider sends people back to: finishes signing in, then returns them to the page they were on. */
export function AuthCallback() {
  const [error, setError] = useState<string>();
  const loaded = useConfig((s) => s.loaded);
  const complete = useAuth((s) => s.completeSignIn);

  useEffect(() => {
    if (!loaded) return; // the provider's details come with the server's config
    let cancelled = false;
    // Finishing a sign-in can only happen once; React may run this effect twice, so both runs share one attempt.
    (finishing ??= complete(location.href))
      .then((returnTo) => !cancelled && location.replace(returnTo))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : COPY.account.failed));
    return () => {
      cancelled = true;
    };
  }, [loaded, complete]);

  return (
    <main>
      {error ? (
        <section className="state-card" role="alert">
          <h2>{COPY.account.failed}</h2>
          <p>{error}</p>
          <div className="actions">
            <button className="primary" onClick={() => location.replace('/')}>
              {COPY.account.backHome}
            </button>
          </div>
        </section>
      ) : (
        <p role="status">{COPY.account.signingIn}</p>
      )}
    </main>
  );
}
