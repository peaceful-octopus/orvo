export type GifMode = 'sticker' | 'fill';

export interface GifSource {
  /** An MP4 URL. Giphy serves every GIF as MP4 too, which is far smaller and can be drawn to a canvas like video. */
  url: string;
  width: number;
  height: number;
}

interface Rendition {
  mp4?: string;
  width?: string | number;
  height?: string | number;
}

/** The shape of Giphy's `images` object that matters here; other fields are ignored. */
export type GifImages = Record<string, Rendition | undefined>;

// Smaller renditions load faster, which matters for a sticker shown for a few seconds. A GIF that replaces the whole
// video is scaled up, so it takes the sharpest one.
const PREFERENCE: Record<GifMode, string[]> = {
  sticker: ['downsized_small', 'fixed_height_small', 'fixed_width', 'fixed_height', 'downsized_medium', 'original'],
  fill: ['original', 'downsized_medium', 'fixed_height', 'fixed_width', 'downsized_small', 'fixed_height_small'],
};

export function pickGifSource(images: GifImages, mode: GifMode): GifSource | undefined {
  for (const name of PREFERENCE[mode]) {
    const rendition = images[name];
    const width = Number(rendition?.width);
    const height = Number(rendition?.height);
    if (rendition?.mp4 && width > 0 && height > 0) return { url: rendition.mp4, width, height };
  }
  return undefined;
}
