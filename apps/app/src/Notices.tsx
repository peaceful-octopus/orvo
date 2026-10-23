import { useState } from 'react';
import { CLIENT_VERSION } from './config';
import { dismissAnnouncement, visibleAnnouncement } from './configLogic';
import { useConfig } from './configStore';

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

/** Shown instead of the app when the server no longer supports this build. */
export function UpdateRequired() {
  const config = useConfig((s) => s.config);
  return (
    <main>
      <h1>Update required</h1>
      <p>
        This version of Orvo ({CLIENT_VERSION}) is too old to talk to the server. Version{' '}
        {config.minClientVersion} or newer is needed.
      </p>
      {config.updateUrl && (
        <p>
          <a href={config.updateUrl}>Get the latest version</a>
        </p>
      )}
    </main>
  );
}
