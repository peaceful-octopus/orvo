/** Background noise suppression for the microphone, using DeepFilterNet3 (a neural model) in an AudioWorklet. */

export interface NoiseFilter {
  /** The microphone track this filter reads. */
  source: MediaStreamTrack;
  /** The cleaned-up audio to send. */
  track: MediaStreamTrack;
  /** 0 to 100. */
  setLevel(level: number): void;
  dispose(): void;
}

/** The filter needs AudioWorklet and WebAssembly; without them the microphone is used as it is. */
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

export async function createNoiseFilter(source: MediaStreamTrack, level: number): Promise<NoiseFilter> {
  // Loaded on demand: the model is several megabytes and many people will have this turned off.
  const { DeepFilterNet3Core } = await import('deepfilternet3-noise-filter');
  const core = new DeepFilterNet3Core({ sampleRate: 48000, noiseReductionLevel: level, assetConfig: { cdnUrl: assetBase() } });
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    await core.initialize();
    const node = await core.createAudioWorkletNode(context);
    const input = context.createMediaStreamSource(new MediaStream([source]));
    const output = context.createMediaStreamDestination();
    input.connect(node);
    node.connect(output);
    await context.resume();
    const track = output.stream.getAudioTracks()[0]!;
    return {
      source,
      track,
      setLevel: (value) => core.setSuppressionLevel(value),
      dispose() {
        track.stop();
        input.disconnect();
        node.disconnect();
        core.destroy();
        void context.close();
      },
    };
  } catch (err) {
    core.destroy();
    void context.close();
    throw err;
  }
}
