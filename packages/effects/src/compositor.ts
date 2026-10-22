import type { GifMode, GifSource } from './gif-source';
import { coverRect, fillAlpha, stickerPlacement } from './layout';
import { anyAlive, particleState, spawnReaction, type Particle } from './particles';

export const DEFAULT_GIF_MS = 6000;
const IDLE_TAIL_MS = 300;
const MAX_PARTICLES = 90;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

/** What the controller needs from a compositor, so tests can substitute a fake. */
export interface CompositorLike {
  /** Camera video with the effects drawn on it, plus the camera's audio. */
  readonly output: MediaStream;
  ready(): Promise<void>;
  react(emoji: string): void;
  showGif(source: GifSource, mode: GifMode, durationMs?: number): Promise<void>;
  /** Called once when the last effect has finished. */
  onIdle(callback: () => void): void;
  dispose(): void;
}

interface ActiveGif {
  video: HTMLVideoElement;
  mode: GifMode;
  source: GifSource;
  startedAt: number;
  durationMs: number;
}

/** Runs timers on a worker, which browsers do not throttle when the window is in the background. */
function startTicker(intervalMs: number, tick: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${intervalMs})`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = tick;
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }
}

/** Resolves on `event`; rejects on `failEvent` (when given) or after `timeoutMs`. */
function once(target: EventTarget, event: string, timeoutMs: number, failEvent?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => () => {
      clearTimeout(timer);
      target.removeEventListener(event, onOk);
      if (failEvent) target.removeEventListener(failEvent, onFail);
      fn();
    };
    const onOk = done(resolve);
    const onFail = done(() => reject(new Error(`The media failed to load (${failEvent}).`)));
    const timer = setTimeout(done(() => reject(new Error(`Timed out waiting for ${event}.`))), timeoutMs);
    target.addEventListener(event, onOk, { once: true });
    if (failEvent) target.addEventListener(failEvent, onFail, { once: true });
  });
}

/**
 * Draws the camera onto a canvas with emoji reactions and GIFs on top, and exposes that canvas as a video track
 * (with the camera's own audio). Everyone in the call receives the result, so effects need no extra messages.
 */
export class Compositor implements CompositorLike {
  readonly output: MediaStream;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private cameraVideo = document.createElement('video');
  private stopTicker?: () => void;
  private canvasTrack: MediaStreamTrack;
  private particles: Particle[] = [];
  private gif?: ActiveGif;
  private idleAt?: number;
  private idleCallbacks: (() => void)[] = [];
  private disposed = false;

  constructor(
    private camera: MediaStream,
    private opts: { fps?: number; now?: () => number; random?: () => number } = {},
  ) {
    const settings = camera.getVideoTracks()[0]?.getSettings();
    this.canvas.width = settings?.width ?? 640;
    this.canvas.height = settings?.height ?? 480;
    this.ctx = this.canvas.getContext('2d')!;

    this.cameraVideo.muted = true;
    this.cameraVideo.playsInline = true;
    this.cameraVideo.srcObject = camera;

    const fps = opts.fps ?? 30;
    const captured = this.canvas.captureStream(fps);
    this.canvasTrack = captured.getVideoTracks()[0]!;
    this.output = new MediaStream([this.canvasTrack, ...camera.getAudioTracks()]);
    this.stopTicker = startTicker(Math.round(1000 / fps), () => this.draw());
  }

  private now() {
    return (this.opts.now ?? performance.now.bind(performance))();
  }

  async ready() {
    await this.cameraVideo.play().catch(() => {});
    if (this.cameraVideo.readyState < 2) await once(this.cameraVideo, 'loadeddata', 3000).catch(() => {});
    if (this.cameraVideo.videoWidth) {
      this.canvas.width = this.cameraVideo.videoWidth;
      this.canvas.height = this.cameraVideo.videoHeight;
    }
    this.draw();
  }

  react(emoji: string) {
    this.idleAt = undefined;
    const burst = spawnReaction(emoji, this.canvas.width, this.canvas.height, this.now(), this.opts.random ?? Math.random);
    this.particles = [...this.particles, ...burst].slice(-MAX_PARTICLES);
  }

  async showGif(source: GifSource, mode: GifMode, durationMs = DEFAULT_GIF_MS) {
    this.idleAt = undefined;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; // otherwise drawing it would taint the canvas and block the stream
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.src = source.url;
    try {
      await once(video, 'canplay', 6000, 'error');
      await video.play();
    } catch (err) {
      video.removeAttribute('src');
      video.load();
      throw err instanceof Error ? err : new Error('The GIF could not be loaded.');
    }
    this.releaseGif();
    this.gif = { video, mode, source, startedAt: this.now(), durationMs };
  }

  onIdle(callback: () => void) {
    this.idleCallbacks.push(callback);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTicker?.();
    this.releaseGif();
    this.cameraVideo.pause();
    this.cameraVideo.srcObject = null;
    // Only the canvas track is ours; the audio tracks are the camera's and keep running.
    this.canvasTrack.stop();
  }

  private releaseGif() {
    if (!this.gif) return;
    this.gif.video.pause();
    this.gif.video.removeAttribute('src');
    this.gif.video.load();
    this.gif = undefined;
  }

  private draw() {
    if (this.disposed) return;
    const { ctx, canvas } = this;
    const now = this.now();
    const { width: W, height: H } = canvas;

    if (this.cameraVideo.readyState >= 2 && this.cameraVideo.videoWidth) {
      const r = coverRect(this.cameraVideo.videoWidth, this.cameraVideo.videoHeight, W, H);
      ctx.drawImage(this.cameraVideo, r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = '#231f38';
      ctx.fillRect(0, 0, W, H);
    }

    const gif = this.gif;
    if (gif) {
      const age = now - gif.startedAt;
      if (age >= gif.durationMs) {
        this.releaseGif();
      } else if (gif.video.readyState >= 2) {
        if (gif.mode === 'fill') {
          const r = coverRect(gif.source.width, gif.source.height, W, H);
          ctx.globalAlpha = fillAlpha(age, gif.durationMs);
          ctx.drawImage(gif.video, r.x, r.y, r.w, r.h);
          ctx.globalAlpha = 1;
        } else {
          const p = stickerPlacement(gif.source.width, gif.source.height, W, H, age, gif.durationMs);
          if (p.w > 1 && p.h > 1) {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.roundRect(p.x, p.y, p.w, p.h, Math.min(p.w, p.h) * 0.08);
            ctx.clip();
            ctx.drawImage(gif.video, p.x, p.y, p.w, p.h);
            ctx.restore();
          }
        }
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const particle of this.particles) {
      const s = particleState(particle, now);
      if (!s.alive || s.alpha <= 0 || s.size < 1) continue;
      ctx.globalAlpha = s.alpha;
      ctx.font = `${Math.round(s.size)}px ${EMOJI_FONT}`;
      ctx.fillText(particle.emoji, s.x, s.y);
    }
    ctx.globalAlpha = 1;
    if (this.particles.length && !anyAlive(this.particles, now)) this.particles = [];

    if (!this.particles.length && !this.gif) {
      this.idleAt ??= now + IDLE_TAIL_MS;
      if (now >= this.idleAt) {
        const callbacks = this.idleCallbacks;
        this.idleCallbacks = [];
        for (const callback of callbacks) callback();
      }
    }
  }
}
