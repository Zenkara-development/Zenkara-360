// ─── Face ID re-enrolment helpers (HR-005) ──────────────────────────────────
//
// The rule this file exists to enforce: an employee who already has an
// active Face ID cannot remove or replace it. They can *ask* for a
// replacement, and a Super Admin decides.
//
// Three ideas carry the whole feature, and they are deliberately kept apart:
//
//   1. FaceEnrollment        — the *effective* state. The face that works
//                             today for attendance. Only an approval
//                             transaction may replace it.
//   2. FaceReenrollmentRequest — the *decision*. A pending row holds the
//                             new samples and the reviewer's verdict. It
//                             never changes the effective state on its own.
//   3. The employee's Face ID status — *derived* from the two above:
//                             VERIFIED, PENDING_VERIFICATION or NOT_ENROLLED.
//
// A request that is pending leaves the active enrolment completely alone,
// so the old face keeps clocking people in while a manager thinks about it.
//
// ── Retention ───────────────────────────────────────────────────────────────
//
//   • Cancelled  — a submission the employee backs out of never creates a
//                  row, so there is nothing to clean up.
//   • Pending    — kept in full until a Super Admin decides.
//   • Rejected   — the biometric payload (descriptors + sample images) is
//                  purged at decision time; the audit trail (who, when,
//                  why) is kept. A rejected capture is not a face we need.
//   • Approved   — the payload is handed over to the new FaceEnrollment,
//                  which becomes the single source of truth for the
//                  employee's live face data. The request row is kept as
//                  the record of the decision.
//   • Expired    — pending requests do not expire on their own; a Super
//                  Admin can approve or reject one at any time, and the
//                  employee can ask a Super Admin to reject it if it is
//                  stale.

import { z } from 'zod';
import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';
import { createNotification } from '../modules/notifications/notifications.controller';
import {
  DescriptorSchema, SelfieSchema, MAX_ENROLLMENT_SAMPLES, assertPlausibleDescriptor,
} from './faceVerification';

export const REENROLLMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReenrollmentStatus = (typeof REENROLLMENT_STATUSES)[number];

/** The effective Face ID state of an employee, derived from the two tables above. */
export type EffectiveFaceStatus = 'VERIFIED' | 'PENDING_VERIFICATION' | 'NOT_ENROLLED';

/**
 * A re-enrolment submission: the descriptors plus every captured image.
 *
 * `sampleImages` is optional so the API stays usable by a client that only
 * sends signatures — but the app's own capture flow always sends them, and
 * the review screen is built around actually looking at the pictures rather
 * than comparing numeric embeddings.
 */
export const ReenrollmentSubmissionSchema = z.object({
  descriptors: z.array(DescriptorSchema).min(1).max(MAX_ENROLLMENT_SAMPLES),
  sampleImages: z.array(SelfieSchema).min(1).max(MAX_ENROLLMENT_SAMPLES).optional(),
});

export const ReenrollmentRejectSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

/** Validates a parsed submission's descriptors the same way enrolment does. */
export function assertValidDescriptors(descriptors: number[][]): void {
  descriptors.forEach(assertPlausibleDescriptor);
}

/**
 * Who may review a Face ID re-enrolment.
 *
 * Org owners only. The permission engine has no narrower key that means
 * "may approve a biometric change", and the business rule names the Super
 * Admin specifically — so this is deliberately not widened to every manager
 * or HR user.
 */
export async function faceReviewerIds(orgId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      orgId,
      isActive: true,
      OR: [{ role: 'SUPER_ADMIN' as any }, { roleRef: { is: { key: 'SUPER_ADMIN' } } }],
    },
    select: { id: true },
  });
  return rows.map(r => r.id);
}

/** Tells the org's Super Admins that a re-enrolment is waiting for them. */
export async function notifyFaceReviewers(
  orgId: string,
  payload: { requestId: string; employeeName: string },
): Promise<void> {
  const ids = await faceReviewerIds(orgId);
  await Promise.all(
    ids.map(id =>
      createNotification({
        orgId,
        userId: id,
        type: 'ASSIGNMENT',
        title: 'Face ID re-enrolment awaiting approval',
        body: `${payload.employeeName} submitted a new Face ID for review.`,
        entityType: 'FACE_REENROLLMENT_REQUEST',
        entityId: payload.requestId,
      }).catch(() => {
        /* a notification failure must never fail the submission */
      }),
    ),
  );
}

/** Tells the employee how their re-enrolment was decided. */
export async function notifyFaceDecision(
  orgId: string,
  userId: string,
  payload: { decision: ReenrollmentStatus; reason?: string | null },
): Promise<void> {
  try {
    await createNotification({
      orgId,
      userId,
      type: 'STATUS_CHANGE',
      title: `Face ID re-enrolment ${payload.decision === 'APPROVED' ? 'approved' : 'rejected'}`,
      body:
        payload.decision === 'APPROVED'
          ? 'Your new Face ID is active and ready to use at check-in.'
          : `Your current Face ID is still active.${payload.reason ? ` Reason: ${payload.reason}` : ''}`,
      entityType: 'FACE_REENROLLMENT_REQUEST',
    });
  } catch {
    /* non-fatal */
  }
}

/** The employee details a reviewer is allowed to see about the requester. */
export interface FaceRequestEmployee {
  userId: string;
  name: string;
  employeeId: string | null;
  employeeCode: string | null;
  department: string | null;
  workEmail: string | null;
  designation: string | null;
}

/** Narrows a User (+ optional Employee) to the fields the review screen shows. */
export function toFaceEmployee(user: {
  id: string;
  name: string;
  email: string | null;
  employee?: {
    id: string;
    employeeCode: string;
    displayName: string;
    workEmail: string | null;
    designation: string | null;
    department: { name: string } | null;
  } | null;
}): FaceRequestEmployee {
  const emp = user.employee ?? null;
  return {
    userId: user.id,
    name: emp?.displayName || user.name,
    employeeId: emp?.id ?? null,
    employeeCode: emp?.employeeCode ?? null,
    department: emp?.department?.name ?? null,
    workEmail: emp?.workEmail ?? user.email ?? null,
    designation: emp?.designation ?? null,
  };
}

/** The select shape used wherever a request's employee details are needed. */
export const faceEmployeeSelect = {
  id: true,
  name: true,
  email: true,
  employee: {
    select: {
      id: true,
      employeeCode: true,
      displayName: true,
      workEmail: true,
      designation: true,
      department: { select: { name: true } },
    },
  },
} as const;

/** Reads the stored sample images off a request/enrolment row. */
export function storedImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.startsWith('data:image/'));
}

/**
 * The employee's effective Face ID state.
 *
 * A pending request does NOT downgrade the effective state to "not enrolled" —
 * the old face is still the one that works. It only adds "there is a decision
 * outstanding", which the UI shows as Pending Verification.
 */
export function effectiveFaceStatus(
  enrollment: { id: string } | null,
  latestRequest: { status: string } | null,
): EffectiveFaceStatus {
  if (latestRequest?.status === 'PENDING') return 'PENDING_VERIFICATION';
  return enrollment ? 'VERIFIED' : 'NOT_ENROLLED';
}

/** Guards a decision: only a pending request may be decided. */
export function assertPending(request: { id: string; status: string }): void {
  if (request.status !== 'PENDING') {
    throw new AppError(
      409,
      `This request was already ${String(request.status).toLowerCase()} — refresh to see the current state.`,
    );
  }
}
