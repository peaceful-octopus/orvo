const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

/**
 * Turns what a user typed into a server origin. Returns '' for empty input (use the default),
 * null for input that is not a usable http(s) address. A missing scheme becomes http for local
 * addresses and https for everything else.
 */
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${LOCAL_HOST.test(text.split('/')[0] ?? '') ? 'http' : 'https'}://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
