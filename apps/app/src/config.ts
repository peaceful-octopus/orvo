// A packaged Tauri app is served from tauri.localhost, so the page's own hostname is not the signaling host.
const inTauri = '__TAURI_INTERNALS__' in window;

export const SIGNALING_URL: string =
  import.meta.env.VITE_SIGNALING_URL ?? (inTauri ? 'http://localhost:9000' : `http://${location.hostname}:9000`);
