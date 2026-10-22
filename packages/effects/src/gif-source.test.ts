import { describe, expect, it } from 'vitest';
import { pickGifSource } from './gif-source';

const images = {
  original: { mp4: 'https://m/original.mp4', width: '480', height: '270' },
  downsized_small: { mp4: 'https://m/small.mp4', width: '250', height: '140' },
  fixed_height: { mp4: 'https://m/fixed.mp4', width: '356', height: '200' },
};

describe('pickGifSource', () => {
  it('takes the small rendition for a sticker and the sharpest for a GIF that fills the video', () => {
    expect(pickGifSource(images, 'sticker')).toEqual({ url: 'https://m/small.mp4', width: 250, height: 140 });
    expect(pickGifSource(images, 'fill')).toEqual({ url: 'https://m/original.mp4', width: 480, height: 270 });
  });

  it('falls back to what exists, skipping renditions without an MP4 or a size', () => {
    const noMp4 = { downsized_small: { width: '250', height: '140' }, fixed_height: images.fixed_height };
    expect(pickGifSource(noMp4, 'sticker')?.url).toBe('https://m/fixed.mp4');
    expect(pickGifSource({ original: { mp4: 'https://m/o.mp4', width: '0', height: '0' } }, 'fill')).toBeUndefined();
  });

  it('accepts numeric sizes', () => {
    expect(pickGifSource({ original: { mp4: 'https://m/o.mp4', width: 100, height: 50 } }, 'fill')).toEqual({
      url: 'https://m/o.mp4',
      width: 100,
      height: 50,
    });
  });

  it('returns nothing when no rendition is usable', () => {
    expect(pickGifSource({}, 'sticker')).toBeUndefined();
    expect(pickGifSource({ original: undefined }, 'fill')).toBeUndefined();
  });
});
