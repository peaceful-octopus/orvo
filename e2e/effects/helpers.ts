import type { BrowserContext, Page } from '@playwright/test';

/**
 * Counts saturated pixels that are not green in one of the call's videos. The fake camera is entirely green, so
 * anything else is an effect that was drawn on it. `which` 0 is your own bubble, 1 the first remote one.
 */
export async function effectPixels(page: Page, which: 0 | 1): Promise<number> {
  return page.locator('.bubble video').nth(which).evaluate((video) => {
    const v = video as HTMLVideoElement;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 120;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0, 160, 120);
    const { data } = ctx.getImageData(0, 0, 160, 120);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === 0 || (max - min) / max < 0.3 || max < 80) continue;
      const d = max - min;
      const hue = max === r ? ((((g - b) / d) % 6) + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const degrees = hue * 60;
      if (degrees < 60 || degrees >= 180) count++;
    }
    return count;
  });
}

/** A short clip of one solid color, recorded in the browser, to stand in for a GIF's MP4. */
export async function solidClip(page: Page, color: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 250;
    canvas.height = 190;
    const ctx = canvas.getContext('2d')!;
    const paint = () => {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    paint();
    const timer = setInterval(paint, 40);
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start();
    await new Promise((r) => setTimeout(r, 1500));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }, color);
  return Buffer.from(base64, 'base64');
}

const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64');

export interface FakeGiphy {
  /** URLs of API requests made to the fake Giphy. */
  apiRequests: string[];
}

/**
 * Answers the Giphy API and media hosts for a context: every search or trending request returns one GIF whose
 * "MP4" is `clip` (or a 404 when `clip` is undefined, to test a GIF that cannot load).
 */
export async function fakeGiphy(context: BrowserContext, clip: Buffer | undefined): Promise<FakeGiphy> {
  const state: FakeGiphy = { apiRequests: [] };
  const rendition = (width: number, height: number) => ({
    url: 'https://media.giphy.test/thumb.gif',
    webp: 'https://media.giphy.test/thumb.gif',
    mp4: 'https://media.giphy.test/clip.mp4',
    width: String(width),
    height: String(height),
    size: '1000',
    mp4_size: '1000',
    webp_size: '1000',
  });
  const gif = {
    type: 'gif',
    id: 'e2egif1',
    url: 'https://giphy.test/e2egif1',
    title: 'Test GIF',
    rating: 'g',
    images: {
      original: rendition(250, 190),
      downsized_small: rendition(250, 190),
      fixed_width: rendition(200, 152),
      fixed_height: rendition(260, 200),
      fixed_width_small: rendition(100, 76),
      fixed_height_small: rendition(130, 100),
      preview_gif: rendition(100, 76),
    },
  };

  await context.route('**/api.giphy.com/**', (route) => {
    state.apiRequests.push(route.request().url());
    return route.fulfill({
      json: {
        data: [gif],
        pagination: { total_count: 1, count: 1, offset: 0 },
        meta: { status: 200, msg: 'OK', response_id: 'e2e' },
      },
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await context.route('**/media.giphy.test/**', (route) => {
    const url = route.request().url();
    const cors = { 'access-control-allow-origin': '*' };
    if (url.endsWith('clip.mp4')) {
      return clip
        ? route.fulfill({ status: 200, body: clip, contentType: 'video/webm', headers: cors })
        : route.fulfill({ status: 404, body: 'gone', headers: cors });
    }
    return route.fulfill({ status: 200, body: PIXEL_GIF, contentType: 'image/gif', headers: cors });
  });
  await context.route('**/pingback.giphy.com/**', (route) => route.fulfill({ status: 204 }));
  return state;
}

/** Average colourfulness (0 grey to 1 vivid) of one of the call's videos. `which` 0 is your own bubble. */
export async function saturation(page: Page, which: number): Promise<number> {
  return page.locator('.bubble video').nth(which).evaluate((video) => {
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(video as HTMLVideoElement, 0, 0, 80, 60);
    const { data } = ctx.getImageData(0, 0, 80, 60);
    let total = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
      const min = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
      if (max < 30) continue; // black corners carry no colour either way
      total += (max - min) / max;
      n++;
    }
    return n ? total / n : 0;
  });
}
