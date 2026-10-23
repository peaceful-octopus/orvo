import { isValidRoomSlug } from '@orvo/protocol';

/**
 * Reads a room from what someone typed or pasted: a room name, or a link ending in /r/<name>.
 * Names are matched case-insensitively and spaces become hyphens. Returns null when it is not a usable room.
 */
export function parseRoomInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const link = text.match(/\/r\/([^/?#\s]+)\/?(?:[?#].*)?$/i);
  const slug = (link?.[1] ?? text).toLowerCase().replace(/\s+/g, '-');
  return isValidRoomSlug(slug) ? slug : null;
}

/** The shareable address of a room on the server this app uses. */
export function roomLink(slug: string, serverUrl: string): string {
  return new URL(`/r/${slug}`, serverUrl).href;
}

/** Puts text on the clipboard; returns false when the system refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall back to the older selection-based copy for webviews without clipboard access.
    const box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.append(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  }
}
