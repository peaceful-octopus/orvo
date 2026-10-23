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
  account: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    signInToStart: 'Sign in to start a room',
    guestsHint: 'You are using ChillCall as a guest.',
    onlySignedIn: 'Only signed-in people can join',
    roomForSignedIn: { title: 'This room is for signed-in people', body: 'Sign in to join it.' },
    needsLoginToStart: { title: 'Sign in to start this room', body: 'This server only lets signed-in people start a room. Nobody has started this one yet.' },
    expired: { title: 'Your sign-in ran out', body: 'Sign in again to carry on.' },
    signingIn: 'Signing you in...',
    waiting: 'Finish signing in in your browser...',
    failed: 'Sign-in did not work.',
    backHome: 'Back to start',
  },
  room: {
    menu: 'Room controls',
    lock: { label: 'Lock the room', hint: 'Only people who are already here can join.' },
    signedInHint: 'Guests cannot join.',
    kick: {
      title: (name: string) => `Remove ${name}?`,
      body: 'They are taken out of the call. If the room is open, they could come back as someone new. Lock the room to prevent that.',
      bodyLocked: 'They are taken out of the call and cannot come back to this room.',
      remove: 'Remove',
      removeAndLock: 'Remove and lock the room',
      cancel: 'Cancel',
      aria: (name: string) => `Remove ${name} from the room`,
    },
    locked: { title: 'This room is locked', body: 'Only people who were already in it can join. Ask its owner to unlock it.' },
    kicked: { title: 'You were removed from this room', body: 'The room\'s owner removed you, so you cannot join it again.' },
    backHome: 'Back to start',
  },
  toasts: {
    kickFailed: 'Could not remove that person.',
    roomAccess: 'Could not change who can join this room.',
    signInFailed: 'Could not reach the sign-in provider. Try again.',
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
