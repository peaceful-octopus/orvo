/** A face found in the camera picture, in the picture's own pixels. */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a person is in the camera picture: opacity 1 on the person, 0 elsewhere. Covers the whole picture. */
export interface PersonMask {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * What the compositor needs from face detection and person segmentation. The app supplies one built on MediaPipe;
 * tests supply a fake. Both calls return the latest answer, or undefined while the model is still loading.
 */
export interface VisionProvider {
  detectFace(video: HTMLVideoElement, now: number): FaceBox | undefined;
  segment(video: HTMLVideoElement, now: number): PersonMask | undefined;
  dispose(): void;
}

/** How the camera picture is treated before filters: blur what is behind you, and keep your face in frame. */
export interface CameraLook {
  blurBackground: boolean;
  autoFrame: boolean;
}

export const PLAIN_LOOK: CameraLook = { blurBackground: false, autoFrame: false };
