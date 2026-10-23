import type { FaceBox, PersonMask, VisionProvider } from '@orvo/effects';

/**
 * Face detection and person segmentation with MediaPipe, for keeping you in frame and blurring what is behind you.
 * The runtime comes from the npm package and the two models from apps/app/public/mediapipe, all served from our own
 * origin. Each part loads the first time it is asked for, and answers "nothing yet" until it is ready.
 */

const WASM_DIR = '/mediapipe/wasm';
const MODEL_DIR = '/mediapipe/models';
/** The segmenter runs about this often; the picture is redrawn more often with the latest mask. */
const SEGMENT_EVERY_MS = 60;
const DETECT_EVERY_MS = 100;

type Tasks = typeof import('@mediapipe/tasks-vision');
type Fileset = Awaited<ReturnType<Tasks['FilesetResolver']['forVisionTasks']>>;

export function visionSupported(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Tries the GPU first and falls back to the CPU, since not every machine can run the model on the GPU. Automated tests
 * on machines with no real GPU set `window.__visionDelegate = 'CPU'`, because software-emulated graphics stall the page.
 */
async function withDelegate<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  if ((window as { __visionDelegate?: string }).__visionDelegate === 'CPU') return create('CPU');
  try {
    return await create('GPU');
  } catch {
    return create('CPU');
  }
}

export function createVision(): VisionProvider {
  let tasks: Promise<{ module: Tasks; fileset: Fileset }> | undefined;
  const load = () =>
    (tasks ??= import('@mediapipe/tasks-vision').then(async (module) => ({
      module,
      fileset: await module.FilesetResolver.forVisionTasks(WASM_DIR),
    })));

  let faceDetector: import('@mediapipe/tasks-vision').FaceDetector | undefined;
  let faceStarted = false;
  let lastFace: FaceBox | undefined;
  let lastDetectAt = -Infinity;

  let segmenter: import('@mediapipe/tasks-vision').ImageSegmenter | undefined;
  let segmenterStarted = false;
  let personIndex = 0;
  let lastSegmentAt = -Infinity;
  const maskCanvas = document.createElement('canvas');
  let mask: PersonMask | undefined;
  let disposed = false;

  const startFace = () => {
    faceStarted = true;
    void load()
      .then(({ module, fileset }) =>
        withDelegate((delegate) =>
          module.FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${MODEL_DIR}/blaze_face_short_range.tflite`, delegate },
            runningMode: 'VIDEO',
          }),
        ),
      )
      .then((detector) => (disposed ? detector.close() : (faceDetector = detector)))
      .catch(() => {});
  };

  const startSegmenter = () => {
    segmenterStarted = true;
    void load()
      .then(({ module, fileset }) =>
        withDelegate((delegate) =>
          module.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${MODEL_DIR}/selfie_segmenter.tflite`, delegate },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          }),
        ),
      )
      .then((created) => {
        if (disposed) return created.close();
        const labels = created.getLabels();
        const found = labels.findIndex((l) => /person|foreground/i.test(l));
        personIndex = found >= 0 ? found : Math.max(labels.length - 1, 0);
        segmenter = created;
      })
      .catch(() => {});
  };

  return {
    detectFace(video, now) {
      if (!faceStarted) startFace();
      if (faceDetector && video.readyState >= 2 && now - lastDetectAt >= DETECT_EVERY_MS) {
        lastDetectAt = now;
        try {
          const { detections } = faceDetector.detectForVideo(video, now);
          const box = detections[0]?.boundingBox;
          lastFace = box ? { x: box.originX, y: box.originY, w: box.width, h: box.height } : undefined;
        } catch {
          lastFace = undefined;
        }
      }
      return lastFace;
    },

    segment(video, now) {
      if (!segmenterStarted) startSegmenter();
      if (segmenter && video.readyState >= 2 && now - lastSegmentAt >= SEGMENT_EVERY_MS) {
        lastSegmentAt = now;
        try {
          segmenter.segmentForVideo(video, now, (result) => {
            const person = result.confidenceMasks?.[personIndex];
            if (!person) return;
            const { width, height } = person;
            const values = person.getAsFloat32Array();
            if (maskCanvas.width !== width || maskCanvas.height !== height) {
              maskCanvas.width = width;
              maskCanvas.height = height;
            }
            const ctx = maskCanvas.getContext('2d')!;
            const image = ctx.createImageData(width, height);
            for (let i = 0; i < values.length; i++) image.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, values[i]!)) * 255);
            ctx.putImageData(image, 0, 0);
            mask = { source: maskCanvas, width, height };
          });
        } catch {
          // A frame the model cannot read is skipped.
        }
      }
      return mask;
    },

    dispose() {
      disposed = true;
      faceDetector?.close();
      segmenter?.close();
      faceDetector = undefined;
      segmenter = undefined;
    },
  };
}
