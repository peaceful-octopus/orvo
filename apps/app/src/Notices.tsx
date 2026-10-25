import { useState } from 'react';
import { useCall } from './callStore';
import { CLIENT_VERSION } from './config';
import { dismissAnnouncement, visibleAnnouncement } from './configLogic';
import { useConfig } from './configStore';
import { COPY } from './copy';
import { useUpdater } from './updater';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** A notice from the server, such as planned maintenance, that the user can dismiss. */
export function AnnouncementBanner() {
  const config = useConfig((s) => s.config);
  const [, rerender] = useState(0);
  const announcement = visibleAnnouncement(config, storage());
  if (!announcement) return null;

  return (
    <p className="banner announcement" role="status">
      {announcement.text}{' '}
      <button
        className="link"
        onClick={() => {
          dismissAnnouncement(announcement.id, storage());
          rerender((n) => n + 1);
        }}
      >
        Dismiss
      </button>
    </p>
  );
}

/** Desktop app: a newer version is ready. Not shown during a call, since installing restarts the app. */
export function UpdateBanner() {
  const { status, version, install } = useUpdater();
  const inCall = useCall((s) => s.phase === 'in-call');
  const [later, setLater] = useState(false);
  if (status === 'idle' || later || inCall) return null;

  return (
    <p className="banner" role="status">
      {status === 'failed' ? COPY.update.failed : COPY.update.available(version ?? '')}{' '}
      <button className="link" disabled={status === 'installing'} onClick={() => void install()}>
        {status === 'installing' ? COPY.update.installing : COPY.update.install}
      </button>{' '}
      {status !== 'installing' && (
        <button className="link" onClick={() => setLater(true)}>
          {COPY.update.later}
        </button>
      )}
    </p>
  );
}

/** Shown instead of the app when the server no longer supports this build. */
export function UpdateRequired() {
  const config = useConfig((s) => s.config);
  const { status, install } = useUpdater();
  return (
    <main>
      <h1>Update required</h1>
      <p>
        This version of Orvo ({CLIENT_VERSION}) is too old to talk to the server. Version{' '}
        {config.minClientVersion} or newer is needed.
      </p>
      {status !== 'idle' ? (
        <p>
          <button className="primary" disabled={status === 'installing'} onClick={() => void install()}>
            {status === 'installing' ? COPY.update.installing : COPY.update.install}
          </button>
        </p>
      ) : (
        config.updateUrl && (
          <p>
            <a href={config.updateUrl}>Get the latest version</a>
          </p>
        )
      )}
    </main>
  );
}
