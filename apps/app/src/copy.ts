/**
 * Wording for the newer screens and states, kept in one place so it is easy to rewrite. The rest of the interface's
 * text is still written where it is used.
 */
export const COPY = {
  mediaDenied: {
    title: 'ChillCall cannot see your camera or microphone',
    body: 'Allow access in your browser or system settings, then try again.',
    steps: ['Check that the camera and microphone are plugged in and not in use by another app.', 'Allow ChillCall to use them in your privacy settings.'],
    retry: 'Try again',
  },
  alone: {
    text: 'Nobody else is here yet.',
    copy: 'Copy invite link',
    copied: 'Copied',
  },
  roomError: {
    back: 'Back to start',
  },
  devices: 'Devices',
} as const;

/** The message the call store sets when the browser refuses camera or microphone access. */
export const MEDIA_DENIED_MESSAGE = 'Camera or microphone access was denied.';
