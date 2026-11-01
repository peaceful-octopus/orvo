/** A packaged Tauri app: the desktop app or the Android app. A browser has none of the app's native features. */
export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The Android app, which Tauri runs in the system web view. */
export const isAndroid = inTauri && /Android/i.test(navigator.userAgent);

/** The Windows, macOS or Linux app: it has windows to size and move, an updater and a loopback sign-in listener. */
export const isDesktopApp = inTauri && !isAndroid;
