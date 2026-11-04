// ─── Face verification helpers ───────────────────────────────────────────────
//
// The browser (client/src/shared/face.ts, @vladmandic/face-api) turns a webcam
// frame into a 128-float face descriptor. We never receive or process the
// photo for matching — only descriptors — so the server stays light enough
// for Render and no third-party face service is involved. Matching is the
// standard euclidean distance between descriptors; face-api's conventional
// "same person" threshold is 0.6, we default to a stricter 0.5.
//
// Trust model: the descriptor is computed client-side, so this protects
// against the everyday "buddy punching" case (someone else checking in from
// a colleague's phone) rather than a deliberately modified client. The
// selfie captured alongside is kept as evidence for manager review.

import { z } from 'zod';
import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';

export const DESCRIPTOR_LENGTH = 128;
export const MAX_ENROLLMENT_SAMPLES = 5;
/** ~40 KB base64 — enough for a 320px JPEG; anything bigger is rejected rather than stored. */
export const MAX_SELFIE_CHARS = 60_000;

export const DescriptorSchema = z.array(z.number().finite()).length(DESCRIPTOR_LENGTH);
export const SelfieSchema = z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).max(MAX_SELFIE_CHARS);

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < DESCRIPTOR_LENGTH; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}

/** Smallest distance between the live descriptor and any enrolled sample. */
export function bestMatchDistance(live: number[], enrolled: number[][]): number {
  return enrolled.reduce((best, s) => Math.min(best, euclideanDistance(live, s)), Infinity);
}

/** Reject descriptors that are clearly not from the recognition model (all
 *  zeros, absurd magnitudes) before they ever hit the distance check. */
export function assertPlausibleDescriptor(d: number[]) {
  const norm = Math.sqrt(d.reduce((s, v) => s + v * v, 0));
  if (!(norm > 0.3 && norm < 3)) throw new AppError(400, 'Face data looks invalid — please try capturing again.');
}

export async function getOrCreateAttendancePolicy(orgId: string) {
  return prisma.attendancePolicy.upsert({ where: { orgId }, create: { orgId }, update: {} });
}

export type FaceSignal =
  | { status: 'not_enrolled' }
  | { status: 'not_provided' }
  | { status: 'matched'; distance: number }
  | { status: 'mismatch'; distance: number; threshold: number };

/** Compare a live descriptor with the user's enrolment. Never throws for a
 *  missing face — the caller's rule decides whether that matters. */
export async function checkFaceSignal(userId: string, threshold: number, liveDescriptor: number[] | undefined): Promise<FaceSignal> {
  const enrollment = await prisma.faceEnrollment.findUnique({ where: { userId } });
  if (!enrollment) return { status: 'not_enrolled' };
  if (!liveDescriptor) return { status: 'not_provided' };
  assertPlausibleDescriptor(liveDescriptor);
  const samples = (enrollment.descriptors as number[][]).filter(s => Array.isArray(s) && s.length === DESCRIPTOR_LENGTH);
  const distance = Number(bestMatchDistance(liveDescriptor, samples).toFixed(4));
  return distance <= threshold ? { status: 'matched', distance } : { status: 'mismatch', distance, threshold };
}

export function faceNotEnrolledError(action: 'check in' | 'check out') {
  const err = new AppError(428, `Face verification is part of your organisation's ${action} rule — enrol your face first from the Attendance page.`);
  (err as any).code = 'FACE_NOT_ENROLLED';
  return err;
}

export function faceRequiredError(action: 'check in' | 'check out') {
  const err = new AppError(428, `Capture your face to ${action}.`);
  (err as any).code = 'FACE_REQUIRED';
  return err;
}
