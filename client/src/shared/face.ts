/**
 * Browser-side face capture for attendance (enrolment + check-in).
 *
 * Loads @vladmandic/face-api lazily (it pulls in TensorFlow.js, ~1 MB gz) so the
 * rest of the app never pays for it, detects a single face in a webcam frame
 * and returns the 128-float descriptor the server compares against the user's
 * enrolment (server/src/utils/faceVerification.ts). Model weights are served
 * from /models/face (client/public/models/face).
 */

import { asset } from './asset';

type FaceApi = typeof import('@vladmandic/face-api');

let faceApiPromise: Promise<FaceApi> | null = null;

export const MODEL_URL = asset('models/face');

export async function loadFaceApi(): Promise<FaceApi> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch(err => { faceApiPromise = null; throw err; });
  }
  return faceApiPromise;
}

export interface FaceCapture {
  descriptor: number[];
  /** Detection confidence 0–1 */
  score: number;
  /** Face box relative to the video frame (0–1), for the on-screen guide */
  box: { x: number; y: number; width: number; height: number };
}

export type FaceDetectResult =
  | { status: 'ok'; capture: FaceCapture }
  | { status: 'none' }
  | { status: 'multiple' }
  | { status: 'small' };

/** Detect exactly one, reasonably sized face in the current video frame. */
export async function detectFace(video: HTMLVideoElement): Promise<FaceDetectResult> {
  const faceapi = await loadFaceApi();
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const detections = await faceapi.detectAllFaces(video, options).withFaceLandmarks(true).withFaceDescriptors();
  if (detections.length === 0) return { status: 'none' };
  if (detections.length > 1) return { status: 'multiple' };
  const d = detections[0];
  const { x, y, width, height } = d.detection.box;
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  if (width / vw < 0.18) return { status: 'small' };
  return {
    status: 'ok',
    capture: {
      descriptor: Array.from(d.descriptor),
      score: d.detection.score,
      box: { x: x / vw, y: y / vh, width: width / vw, height: height / vh },
    },
  };
}

/** Small JPEG data URL of the current frame (evidence / reference thumbnail). */
export function snapshotDataUrl(video: HTMLVideoElement, maxWidth = 320, quality = 0.7): string {
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((video.videoWidth || maxWidth) * scale);
  canvas.height = Math.round((video.videoHeight || maxWidth * 0.75) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported in this browser.');
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') throw new Error('Camera permission was denied — allow camera access for this site and try again.');
    if (err?.name === 'NotFoundError') throw new Error('No camera was found on this device.');
    throw new Error(err?.message || 'Could not start the camera.');
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => t.stop());
}
