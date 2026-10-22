import { describe, expect, it } from 'vitest';
import type { CompositorLike } from './compositor';
import { EffectsController } from './controller';
import type { GifSource } from './gif-source';

const gif: GifSource = { url: 'https://m/g.mp4', width: 200, height: 100 };

class FakeCompositor implements CompositorLike {
  output = { id: 'effects' } as unknown as MediaStream;
  reactions: string[] = [];
  gifs: GifSource[] = [];
  disposed = false;
  failGif = false;
  private idle: (() => void)[] = [];

  constructor(private readyGate: Promise<void>) {}

  ready() {
    return this.readyGate;
  }
  react(emoji: string) {
    this.reactions.push(emoji);
  }
  async showGif(source: GifSource) {
    if (this.failGif) throw new Error('could not load');
    this.gifs.push(source);
  }
  onIdle(cb: () => void) {
    this.idle.push(cb);
  }
  dispose() {
    this.disposed = true;
  }
  goIdle() {
    this.idle.splice(0).forEach((cb) => cb());
  }
}

function setup(opts: { camera?: MediaStream | undefined; gap?: number; gate?: Promise<void> } = {}) {
  const camera = 'camera' in opts ? opts.camera : ({ id: 'camera' } as unknown as MediaStream);
  const streams: string[] = [];
  const made: FakeCompositor[] = [];
  let t = 0;
  const controller = new EffectsController({
    camera: () => camera,
    setStream: (s) => void streams.push((s as unknown as { id: string }).id),
    create: () => {
      const c = new FakeCompositor(opts.gate ?? Promise.resolve());
      made.push(c);
      return c;
    },
    now: () => t,
    minReactionGapMs: opts.gap,
  });
  return { controller, streams, made, advance: (ms: number) => void (t += ms) };
}

describe('EffectsController', () => {
  it('switches to the effects stream when the first effect starts and back when they end', async () => {
    const { controller, streams, made } = setup();
    expect(controller.active).toBe(false);

    expect(await controller.react('🎉')).toBe(true);
    expect(streams).toEqual(['effects']);
    expect(made[0]!.reactions).toEqual(['🎉']);
    expect(controller.active).toBe(true);

    made[0]!.goIdle();
    expect(streams).toEqual(['effects', 'camera']);
    expect(made[0]!.disposed).toBe(true);
    expect(controller.active).toBe(false);
  });

  it('uses one compositor for effects that overlap, without switching twice', async () => {
    const { controller, streams, made, advance } = setup();
    await controller.react('🎉');
    advance(1000);
    await controller.showGif(gif, 'sticker');
    advance(1000);
    await controller.react('❤️');
    expect(made).toHaveLength(1);
    expect(streams).toEqual(['effects']);
    expect(made[0]!.gifs).toEqual([gif]);
    expect(made[0]!.reactions).toEqual(['🎉', '❤️']);
  });

  it('starts a fresh compositor for an effect after the last one ended', async () => {
    const { controller, streams, made, advance } = setup();
    await controller.react('👍');
    made[0]!.goIdle();
    advance(1000);
    await controller.react('👏');
    expect(made).toHaveLength(2);
    expect(streams).toEqual(['effects', 'camera', 'effects']);
  });

  it('shares one compositor when effects are requested while it is still starting', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { controller, made, advance } = setup({ gap: 0, gate });
    const first = controller.react('🎉');
    advance(1);
    const second = controller.react('😂');
    release();
    await Promise.all([first, second]);
    expect(made).toHaveLength(1);
    expect(made[0]!.reactions).toEqual(['🎉', '😂']);
  });

  it('skips reactions that come too soon after the last one', async () => {
    const { controller, made, advance } = setup({ gap: 250 });
    expect(await controller.react('👍')).toBe(true);
    advance(100);
    expect(await controller.react('👍')).toBe(false);
    advance(200);
    expect(await controller.react('👍')).toBe(true);
    expect(made[0]!.reactions).toHaveLength(2);
  });

  it('rejects effects when there is no camera and does not touch the stream', async () => {
    const { controller, streams } = setup({ camera: undefined });
    await expect(controller.react('🎉')).rejects.toThrow('no camera');
    expect(streams).toEqual([]);
    expect(controller.active).toBe(false);
  });

  it('passes a failing GIF load on to the caller, and the camera returns once the compositor goes idle', async () => {
    const { controller, streams, made } = setup();
    await controller.react('🎉');
    made[0]!.failGif = true;
    await expect(controller.showGif(gif, 'fill')).rejects.toThrow('could not load');
    made[0]!.goIdle();
    expect(streams).toEqual(['effects', 'camera']);
  });

  it('end stops running effects but allows new ones afterwards', async () => {
    const { controller, streams, made, advance } = setup();
    await controller.react('🎉');
    controller.end();
    expect(streams).toEqual(['effects', 'camera']);
    expect(made[0]!.disposed).toBe(true);

    advance(1000);
    await controller.react('🎉');
    expect(made).toHaveLength(2);
    expect(streams).toEqual(['effects', 'camera', 'effects']);
  });

  it('dispose ends effects at once, restores the camera, and refuses further effects', async () => {
    const { controller, streams, made } = setup();
    await controller.react('🎉');
    controller.dispose();
    expect(made[0]!.disposed).toBe(true);
    expect(streams).toEqual(['effects', 'camera']);
    await expect(controller.react('🎉')).rejects.toThrow('not available');
  });
});
