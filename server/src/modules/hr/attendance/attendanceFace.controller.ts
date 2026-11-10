import { Response, NextFunction } from 'express';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import { sseManager, SSEEvent } from '../../../utils/sse';
import {
  ReenrollmentSubmissionSchema, ReenrollmentRejectSchema,
  assertValidDescriptors, assertPending,
  notifyFaceReviewers, notifyFaceDecision,
  faceEmployeeSelect, toFaceEmployee, storedImages, effectiveFaceStatus,
  type ReenrollmentStatus,
} from '../../../utils/faceReenrollment';

/**
 * Face ID re-enrolment (HR-005).
 *
 * An employee who already has an active Face ID cannot replace it — not by
 * calling the enrolment endpoint, and not by deleting anything. They submit
 * a *request*; a Super Admin approves or rejects it. The active enrolment is
 * only ever replaced inside the approval transaction, so a request that is
 * pending (or rejected) leaves the employee's existing face working exactly
 * as before.
 *
 * The request carries the actual sample *images*, not just descriptors: a
 * reviewer decides by looking at the old and new photographs side by side.
 */

// ─── Employee-facing ─────────────────────────────────────────────────────────

/**
 * GET /hr/attendance/face/reenroll/me
 *
 * The employee's Face ID state: the active enrolment, the latest
 * re-enrolment request, and the effective status derived from both. This is
 * what the Attendance page renders — the pending state lives on the server,
 * so it survives a refresh, a logout/login and a trip to another page.
 */
export async function myReenrollment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.id;

    const [enrollment, request] = await Promise.all([
      prisma.faceEnrollment.findUnique({ where: { userId } }),
      prisma.faceReenrollmentRequest.findFirst({
        where: { orgId, userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      enrollment: enrollment
        ? {
            samples: enrollment.samples,
            enrolledAt: enrollment.enrolledAt,
            updatedAt: enrollment.updatedAt,
            referenceSelfie: enrollment.referenceSelfie,
            sampleImages: storedImages(enrollment.sampleImages),
          }
        : null,
      reEnrollment: request
        ? {
            id: request.id,
            status: request.status as ReenrollmentStatus,
            submittedAt: request.createdAt,
            decidedAt: request.decidedAt,
            reviewedAt: request.reviewedAt,
            rejectionReason: request.rejectionReason,
            samples: request.samples,
            sampleCount: storedImages(request.sampleImages).length,
          }
        : null,
      effectiveStatus: effectiveFaceStatus(enrollment, request),
    });
  } catch (err) { next(err); }
}

/**
 * POST /hr/attendance/face/reenroll
 *
 * Submits a re-enrolment request. It never touches the active enrolment —
 * the old face keeps working for attendance until a Super Admin approves the
 * replacement.
 */
export async function submitReenrollment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ReenrollmentSubmissionSchema.parse(req.body);
    assertValidDescriptors(data.descriptors);

    const orgId = req.user!.orgId;
    const userId = req.user!.id;

    const [enrollment, user] = await Promise.all([
      prisma.faceEnrollment.findUnique({ where: { userId } }),
      prisma.user.findFirst({ where: { id: userId, orgId }, select: { id: true, name: true } }),
    ]);
    if (!user) throw new AppError(404, 'User not found');

    // Only someone who already has a Face ID can ask to replace one.
    if (!enrollment) {
      throw new AppError(400, 'You do not have an active Face ID yet — enrol first from the Attendance page.');
    }

    const pending = await prisma.faceReenrollmentRequest.findFirst({
      where: { orgId, userId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) {
      throw new AppError(409, 'You already have a Face ID re-enrolment waiting for approval.');
    }

    const images = data.sampleImages ?? [];

    let request;
    try {
      request = await prisma.faceReenrollmentRequest.create({
        data: {
          orgId,
          userId,
          status: 'PENDING',
          descriptors: data.descriptors as any,
          sampleImages: images as any,
          samples: data.descriptors.length,
          referenceSelfie: images[0] ?? null,
        },
      });
    } catch (err: any) {
      /* The partial unique index (one pending request per employee) is the
         real guard: two browser tabs submitting at the same moment both
         pass the check above, and only the database can settle it. */
      if (err?.code === 'P2002') {
        throw new AppError(409, 'You already have a Face ID re-enrolment waiting for approval.');
      }
      throw err;
    }

    logAction(userId, 'CREATE', 'FaceReenrollmentRequest', request.id, {
      samples: request.samples,
      images: images.length,
    });

    notifyFaceReviewers(orgId, { requestId: request.id, employeeName: user.name }).catch(() => {});
    sseManager.sendToUsers(orgId, [userId], SSEEvent.ATTENDANCE_UPDATED, {
      userId, type: 'face_reenrollment_submitted',
    });

    res.status(201).json({
      id: request.id,
      status: request.status,
      submittedAt: request.createdAt,
      samples: request.samples,
      sampleCount: images.length,
      message: 'Your new Face ID has been sent for approval. Your current Face ID stays active until it is approved.',
    });
  } catch (err) { next(err); }
}

// ─── Reviewer-facing (Super Admin) ───────────────────────────────────────────

/** GET /hr/attendance/face/reenroll/requests — the pending approval queue. */
export async function listReenrollmentRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const rows = await prisma.faceReenrollmentRequest.findMany({
      where: { orgId, status: 'PENDING' },
      include: { user: { select: faceEmployeeSelect } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      data: rows.map(r => ({
        id: r.id,
        status: r.status as ReenrollmentStatus,
        submittedAt: r.createdAt,
        samples: r.samples,
        sampleCount: storedImages(r.sampleImages).length,
        employee: toFaceEmployee(r.user),
      })),
      total: rows.length,
    });
  } catch (err) { next(err); }
}

/**
 * GET /hr/attendance/face/reenroll/requests/:id
 *
 * Everything the reviewer needs for one request: who asked, when, the images
 * that are live today (old) and the images in the request (new). Descriptors
 * are never sent to the browser — they are not something a human compares.
 */
export async function getReenrollmentRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const request = await prisma.faceReenrollmentRequest.findFirst({
      where: { id: req.params.id, orgId },
      include: { user: { select: faceEmployeeSelect } },
    });
    if (!request) throw new AppError(404, 'Re-enrolment request not found');

    const enrollment = await prisma.faceEnrollment.findUnique({
      where: { userId: request.userId },
    });

    res.json({
      id: request.id,
      status: request.status as ReenrollmentStatus,
      submittedAt: request.createdAt,
      decidedAt: request.decidedAt,
      reviewedAt: request.reviewedAt,
      rejectionReason: request.rejectionReason,
      samples: request.samples,
      employee: toFaceEmployee(request.user),
      current: enrollment
        ? {
            samples: enrollment.samples,
            enrolledAt: enrollment.enrolledAt,
            referenceSelfie: enrollment.referenceSelfie,
            sampleImages: storedImages(enrollment.sampleImages),
          }
        : null,
      submitted: {
        sampleCount: storedImages(request.sampleImages).length,
        sampleImages: storedImages(request.sampleImages),
      },
      canAct: request.status === 'PENDING',
    });
  } catch (err) { next(err); }
}

/**
 * POST /hr/attendance/face/reenroll/requests/:id/approve
 *
 * Retires the old enrolment and activates the approved one in a single
 * transaction. If any part of it fails, the old enrolment is still there and
 * the request is still pending — a request can never be marked approved
 * without the new face actually going live.
 */
export async function approveReenrollment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const reviewerId = req.user!.id;
    const now = new Date();

    const request = await prisma.$transaction(async (tx) => {
      const found = await tx.faceReenrollmentRequest.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!found) throw new AppError(404, 'Re-enrolment request not found');
      assertPending(found);

      // The employee must still belong to this organization.
      const employee = await tx.user.findFirst({
        where: { id: found.userId, orgId },
        select: { id: true },
      });
      if (!employee) throw new AppError(404, 'That employee is no longer in this organization.');

      // Retire the old enrolment, then activate the new one.
      await tx.faceEnrollment.deleteMany({ where: { userId: found.userId } });
      await tx.faceEnrollment.create({
        data: {
          orgId: found.orgId,
          userId: found.userId,
          descriptors: found.descriptors as any,
          samples: found.samples,
          referenceSelfie: found.referenceSelfie,
          sampleImages: found.sampleImages as any,
          enrolledAt: now,
        },
      });

      await tx.faceReenrollmentRequest.update({
        where: { id: found.id },
        data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: now, decidedAt: now },
      });

      return found;
    });

    logAction(reviewerId, 'UPDATE', 'FaceReenrollmentRequest', request.id, {
      decision: 'APPROVED',
      samples: request.samples,
    });

    notifyFaceDecision(orgId, request.userId, { decision: 'APPROVED' }).catch(() => {});
    sseManager.sendToUsers(orgId, [request.userId], SSEEvent.ATTENDANCE_UPDATED, {
      userId: request.userId, type: 'face_reenrollment_approved',
    });

    res.json({
      id: request.id,
      status: 'APPROVED',
      decidedAt: now,
      message: 'Approved — the new Face ID is now the employee\'s active Face ID.',
    });
  } catch (err) { next(err); }
}

/**
 * POST /hr/attendance/face/reenroll/requests/:id/reject
 *
 * The previous enrolment is left completely alone: a rejected request must
 * never remove or overwrite the face that is already working. The rejected
 * biometric payload is discarded; the decision itself is kept for audit.
 */
export async function rejectReenrollment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ReenrollmentRejectSchema.parse(req.body ?? {});
    const orgId = req.user!.orgId;
    const reviewerId = req.user!.id;
    const now = new Date();

    const request = await prisma.$transaction(async (tx) => {
      const found = await tx.faceReenrollmentRequest.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!found) throw new AppError(404, 'Re-enrolment request not found');
      assertPending(found);

      await tx.faceReenrollmentRequest.update({
        where: { id: found.id },
        data: {
          status: 'REJECTED',
          reviewedBy: reviewerId,
          reviewedAt: now,
          decidedAt: now,
          rejectionReason: data.reason?.trim() ? data.reason.trim() : null,
          // The rejected capture is discarded — the old enrolment stays live.
          descriptors: [] as any,
          sampleImages: [] as any,
        },
      });

      return found;
    });

    logAction(reviewerId, 'UPDATE', 'FaceReenrollmentRequest', request.id, {
      decision: 'REJECTED',
      reason: data.reason ?? null,
    });

    notifyFaceDecision(orgId, request.userId, {
      decision: 'REJECTED',
      reason: data.reason ?? null,
    }).catch(() => {});
    sseManager.sendToUsers(orgId, [request.userId], SSEEvent.ATTENDANCE_UPDATED, {
      userId: request.userId, type: 'face_reenrollment_rejected',
    });

    res.json({
      id: request.id,
      status: 'REJECTED',
      decidedAt: now,
      message: 'Rejected — the employee\'s existing Face ID is unchanged.',
    });
  } catch (err) { next(err); }
}
