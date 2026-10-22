import { Compositor, type CompositorLike } from './compositor';
import { findFilter, type MoodFilter } from './filters';
import type { GifMode, GifSource } from './gif-source';

export interface EffectsControllerOptions {
  /** The camera stream, or undefined when there is none (effects are then refused). */
  camera: () => MediaStream | undefined;
  /**
   * Called with the stream that should be sent and shown while effects run, and with the plain camera again once
   * they are over. The caller swaps the outgoing video track and its own preview.
   */
  setStream: (stream: MediaStream) => void;
  create?: (camera: MediaStream) => CompositorLike;
  now?: () => number;
  /** Shortest time between two reactions from one person, so holding a button does not flood the call. */
  minReactionGapMs?: number;
}

/**
 * Switches the outgoing video to the compositor while an effect is showing or a mood filter is chosen, and back to
 * the plain camera when neither is. With neither, nothing is drawn, encoded twice or throttled with the window.
 */
export class EffectsController {
  private compositor?: CompositorLike;
  private starting?: Promise<CompositorLike>;
  private lastReactionAt = -Infinity;
  private disposed = false;
  private filter?: MoodFilter;

  constructor(private opts: EffectsControllerOptions) {}

  /** True while effects or a mood filter are being drawn into the outgoing video. */
  get active() {
    return this.compositor !== undefined || this.starting !== undefined;
  }

  /** Shows a burst of `emoji`. Returns false when it was skipped for coming too soon after the last one. */
  async react(emoji: string): Promise<boolean> {
    if (this.disposed) throw new Error('Effects are not available.');
    const now = (this.opts.now ?? Date.now)();
    if (now - this.lastReactionAt < (this.opts.minReactionGapMs ?? 250)) return false;
    this.lastReactionAt = now;
    (await this.ensure()).react(emoji);
    return true;
  }

  /** Shows a GIF on or over the video. Rejects if it cannot be loaded; the plain camera is restored then. */
  async showGif(source: GifSource, mode: GifMode, durationMs?: number): Promise<void> {
    // If the GIF cannot load and nothing else is showing, the compositor goes idle and the camera is restored.
    await (await this.ensure()).showGif(source, mode, durationMs);
  }

  /** Applies a mood filter to the camera (by id), or removes it with undefined or an unknown id. */
  async setFilter(id: string | undefined): Promise<void> {
    this.filter = findFilter(id);
    if (this.disposed) return;
    if (this.filter) {
      (await this.ensure()).setFilter(this.filter);
      return;
    }
    const compositor = this.compositor;
    if (!compositor) return;
    compositor.setFilter(undefined);
    // With no filter the compositor is only needed while an effect is still showing.
    if (compositor.busy) compositor.onIdle(() => this.finishIfPlain());
    else this.finish();
  }

  /** Ends any running effects at once. The camera is restored unless a mood filter is still applied. */
  end() {
    if (this.filter && this.compositor) this.compositor.clearEffects();
    else this.finish();
  }

  /** Call after the camera changes: a running filter is redrawn from the new camera, anything else is dropped. */
  async restart(): Promise<void> {
    const compositor = this.compositor;
    if (!this.filter || !compositor) return this.end();
    this.compositor = undefined;
    compositor.dispose();
    await this.ensure();
  }

  /** Like `end`, and refuses all further effects. */
  dispose() {
    this.disposed = true;
    this.finish();
  }

  private ensure(): Promise<CompositorLike> {
    if (this.disposed) return Promise.reject(new Error('Effects are not available.'));
    if (this.compositor) return Promise.resolve(this.compositor);
    this.starting ??= this.start().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async start(): Promise<CompositorLike> {
    const camera = this.opts.camera();
    if (!camera) throw new Error('There is no camera to put effects on.');
    const compositor = (this.opts.create ?? ((c) => new Compositor(c)))(camera);
    await compositor.ready();
    if (this.disposed) {
      compositor.dispose();
      throw new Error('Effects are not available.');
    }
    this.compositor = compositor;
    compositor.setFilter(this.filter);
    compositor.onIdle(() => this.finishIfPlain());
    this.opts.setStream(compositor.output);
    return compositor;
  }

  private finishIfPlain() {
    if (!this.filter) this.finish();
  }

  private finish() {
    const compositor = this.compositor;
    if (!compositor) return;
    this.compositor = undefined;
    compositor.dispose();
    const camera = this.opts.camera();
    if (camera) this.opts.setStream(camera);
  }
}
