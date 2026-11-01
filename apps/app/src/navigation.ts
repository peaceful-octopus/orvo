import { useSyncExternalStore } from 'react';

const CHANGE = 'orvo:navigate';

/**
 * Goes to another page of the app without reloading it, so anything still playing (the leaving chime) finishes. The
 * pages are told apart by the path alone, see `App`.
 */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(CHANGE));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE, onChange);
  };
};

/** The path of the current page; the component renders again when the page changes. */
export const usePath = (): string => useSyncExternalStore(subscribe, () => location.pathname);
