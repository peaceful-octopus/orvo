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
  toasts: {
    screenFailed: 'Could not start screen sharing. Try again.',
    screenBlocked: 'Screen sharing is blocked. Allow screen recording for ChillCall in your system settings.',
    cameraFailed: 'Could not turn your camera on. Check that it is connected and not in use by another app.',
    micFailed: 'Could not turn your microphone on. Check that it is connected and not in use by another app.',
    cameraLost: 'Your camera stopped working, so it has been turned off.',
    micLost: 'Your microphone stopped working, so it has been turned off.',
    switchCamera: 'Could not switch to that camera.',
    switchMic: 'Could not switch to that microphone.',
    reactions: 'Reactions are not available right now.',
    gif: 'That GIF could not be loaded. Try another one.',
    noise: 'Noise suppression could not start, so your microphone is sent as it is.',
    volume: 'The microphone volume could not be applied.',
  },
} as const;

/** The message the call store sets when the browser refuses camera or microphone access. */
export const MEDIA_DENIED_MESSAGE = 'Camera or microphone access was denied.';
