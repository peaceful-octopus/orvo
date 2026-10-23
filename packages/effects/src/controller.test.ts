import { describe, expect, it } from 'vitest';
import type { CompositorLike } from './compositor';
import type { MoodFilter } from './filters';
import type { CameraLook } from './vision';
import { EffectsController } from './controller';
import type { GifSource } from './gif-source';

const gif: GifSource = { url: 'https://m/g.mp4', width: 200, height: 100 };

class FakeCompositor implements CompositorLike {
  output = { id: 'effects' } as unknown as MediaStream;
  reactions: string[] = [];
  gifs: GifSource[] = [];
  disposed = false;
  failGif = false;
  filter?: MoodFilter;
  look?: CameraLook;
  cleared = 0;
  private idle: (() => void)[] = [];

  constructor(private readyGate: Promise<void>) {}

  get busy() {
    return this.reactions.length > 0 && !this.cleared;
  }
  ready() {
    return this.readyGate;
  }
  setFilter(filter: MoodFilter | undefined) {
    this.filter = filter;
  }
  setLook(look: CameraLook) {
    this.look = look;
  }
  clearEffects() {
    this.cleared++;
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

  describe('mood filters', () => {
    it('sends the filtered video as soon as a filter is chosen, and the plain camera when it is removed', async () => {
      const { controller, streams, made } = setup();
      await controller.setFilter('noir');
      expect(streams).toEqual(['effects']);
      expect(made[0]!.filter?.id).toBe('noir');
      expect(controller.active).toBe(true);

      await controller.setFilter(undefined);
      expect(streams).toEqual(['effects', 'camera']);
      expect(made[0]!.disposed).toBe(true);
      expect(controller.active).toBe(false);
    });

    it('keeps the filter running after reactions end', async () => {
      const { controller, streams, made } = setup();
      await controller.setFilter('sunset');
      await controller.react('x');
      made[0]!.goIdle();
      expect(made[0]!.disposed).toBe(false);
      expect(streams).toEqual(['effects']);
    });

    it('ending effects clears them but leaves the filter on', async () => {
      const { controller, streams, made } = setup();
      await controller.setFilter('sunset');
      controller.end();
      expect(made[0]!.cleared).toBe(1);
      expect(streams).toEqual(['effects']);
    });

    it('changes the filter without starting a second compositor', async () => {
      const { controller, made } = setup();
      await controller.setFilter('noir');
      await controller.setFilter('neon');
      expect(made).toHaveLength(1);
      expect(made[0]!.filter?.id).toBe('neon');
    });

    it('treats an unknown id as no filter', async () => {
      const { controller, streams } = setup();
      await controller.setFilter('noir');
      await controller.setFilter('nonsense');
      expect(streams).toEqual(['effects', 'camera']);
    });

    it('waits for a running reaction to finish before dropping the compositor when the filter is removed', async () => {
      const { controller, streams, made } = setup();
      await controller.setFilter('noir');
      await controller.react('x');
      await controller.setFilter(undefined);
      expect(made[0]!.disposed).toBe(false);
      made[0]!.goIdle();
      expect(made[0]!.disposed).toBe(true);
      expect(streams).toEqual(['effects', 'camera']);
    });

    it('redraws from the new camera when the camera changes, keeping the filter', async () => {
      const { controller, streams, made } = setup();
      await controller.setFilter('noir');
      await controller.restart();
      expect(made).toHaveLength(2);
      expect(made[0]!.disposed).toBe(true);
      expect(made[1]!.filter?.id).toBe('noir');
      expect(streams).toEqual(['effects', 'effects']); // no flash of the unfiltered camera in between
    });

    it('restarting with no filter just ends effects', async () => {
      const { controller, streams } = setup();
      await controller.react('x');
      await controller.restart();
      expect(streams).toEqual(['effects', 'camera']);
    });
  });

  describe('background blur and framing', () => {
    it('sends the processed video while blur or framing is on, and the camera when both are off', async () => {
      const { controller, streams, made } = setup();
      await controller.setLook({ blurBackground: true, autoFrame: false });
      expect(streams).toEqual(['effects']);
      expect(made[0]!.look).toEqual({ blurBackground: true, autoFrame: false });

      await controller.setLook({ blurBackground: false, autoFrame: false });
      expect(streams).toEqual(['effects', 'camera']);
      expect(made[0]!.disposed).toBe(true);
    });

    it('keeps one compositor for a filter, blur and framing together, and only drops it when all are off', async () => {
      const { controller, streams, made } = setup();
      await controller.setFilter('noir');
      await controller.setLook({ blurBackground: true, autoFrame: true });
      await controller.setFilter(undefined);
      expect(made).toHaveLength(1);
      expect(made[0]!.disposed).toBe(false);
      await controller.setLook({ blurBackground: false, autoFrame: false });
      expect(made[0]!.disposed).toBe(true);
      expect(streams).toEqual(['effects', 'camera']);
    });

    it('keeps blur through a camera change and through ending effects', async () => {
      const { controller, made } = setup();
      await controller.setLook({ blurBackground: true, autoFrame: false });
      controller.end();
      expect(made[0]!.cleared).toBe(1);
      expect(made[0]!.disposed).toBe(false);
      await controller.restart();
      expect(made).toHaveLength(2);
      expect(made[1]!.look?.blurBackground).toBe(true);
    });

    it('disposes the vision models with the controller', () => {
      let disposed = false;
      const controller = new EffectsController({
        camera: () => undefined,
        setStream: () => {},
        vision: { detectFace: () => undefined, segment: () => undefined, dispose: () => void (disposed = true) },
      });
      controller.dispose();
      expect(disposed).toBe(true);
    });
  });
});
