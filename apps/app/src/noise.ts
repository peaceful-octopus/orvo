/**
 * The microphone's path to the call: an optional DeepFilterNet3 background-noise filter (a neural model in an
 * AudioWorklet) followed by a volume stage.
 */

export interface MicProcessor {
  /** The microphone track this reads. */
  source: MediaStreamTrack;
  /** The processed audio to send. */
  track: MediaStreamTrack;
  /** Whether the noise filter is part of this path. */
  hasNoise: boolean;
  /** Noise filter strength, 0 to 100. */
  setLevel(level: number): void;
  /** Microphone volume as a percentage; 100 leaves the level as it is. */
  setGain(percent: number): void;
  dispose(): void;
}

/** The noise filter needs AudioWorklet and WebAssembly; without them the microphone is used as it is. */
export function noiseSupported(): boolean {
  return typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';
}

/**
 * Where the model and WebAssembly files are served from. They live on our own origin (apps/app/public/noise), not on
 * the package's default third-party CDN, because they are code that runs on every call.
 */
function assetBase(): string {
  return new URL('/noise', location.origin).href;
}

interface Options {
  noise: boolean;
  level: number;
  gain: number;
}

export async function createMicProcessor(source: MediaStreamTrack, { noise, level, gain }: Options): Promise<MicProcessor> {
  const context = new AudioContext({ sampleRate: 48000 });
  let core: { setSuppressionLevel(level: number): void; destroy(): void } | undefined;
  try {
    const input = context.createMediaStreamSource(new MediaStream([source]));
    const volume = context.createGain();
    volume.gain.value = gain / 100;
    const output = context.createMediaStreamDestination();
    let filter: AudioWorkletNode | undefined;

    if (noise) {
      // Loaded on demand: the model is several megabytes and many people will have this turned off.
      const { DeepFilterNet3Core } = await import('deepfilternet3-noise-filter');
      const loaded = new DeepFilterNet3Core({ sampleRate: 48000, noiseReductionLevel: level, assetConfig: { cdnUrl: assetBase() } });
      core = loaded;
      await loaded.initialize();
      filter = await loaded.createAudioWorkletNode(context);
      input.connect(filter);
      filter.connect(volume);
    } else {
      input.connect(volume);
    }
    volume.connect(output);
    await context.resume();

    const track = output.stream.getAudioTracks()[0]!;
    return {
      source,
      track,
      hasNoise: noise,
      setLevel: (value) => core?.setSuppressionLevel(value),
      setGain: (percent) => {
        volume.gain.value = percent / 100;
      },
      dispose() {
        track.stop();
        input.disconnect();
        filter?.disconnect();
        volume.disconnect();
        core?.destroy();
        void context.close();
      },
    };
  } catch (err) {
    core?.destroy();
    void context.close();
    throw err;
  }
}
