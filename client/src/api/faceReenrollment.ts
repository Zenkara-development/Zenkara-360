import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * Face ID re-enrolment (HR-005).
 *
 * An employee with an active Face ID cannot replace it directly. They submit
 * a request, and a Super Admin approves or rejects it. Two separate things
 * are tracked on the server and mirrored here:
 *
 *   • the *request*  — PENDING / APPROVED / REJECTED
 *   • the *enrolment* — the face that is live today (VERIFIED)
 *
 * The status the employee sees is derived from both, so a pending request
 * shows as "Pending Verification" while the old face keeps working.
 */

export type FaceReenrollmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type EffectiveFaceStatus = 'VERIFIED' | 'PENDING_VERIFICATION' | 'NOT_ENROLLED';

export interface MyFaceEnrollment {
  samples: number;
  enrolledAt: string;
  updatedAt: string;
  referenceSelfie: string | null;
  /** Every stored sample image; empty for enrolments that predate image storage. */
  sampleImages: string[];
}

export interface MyFaceReenrollment {
  id: string;
  status: FaceReenrollmentStatus;
  submittedAt: string;
  decidedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  samples: number;
  sampleCount: number;
}

export interface MyFaceState {
  enrollment: MyFaceEnrollment | null;
  reEnrollment: MyFaceReenrollment | null;
  effectiveStatus: EffectiveFaceStatus;
}

export interface FaceReviewEmployee {
  userId: string;
  name: string;
  employeeId: string | null;
  employeeCode: string | null;
  department: string | null;
  workEmail: string | null;
  designation: string | null;
}

export interface FaceReenrollmentRequestSummary {
  id: string;
  status: FaceReenrollmentStatus;
  submittedAt: string;
  samples: number;
  sampleCount: number;
  employee: FaceReviewEmployee;
}

export interface FaceReenrollmentRequestDetail extends FaceReenrollmentRequestSummary {
  decidedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  /** The face that is live today. */
  current: {
    samples: number;
    enrolledAt: string;
    referenceSelfie: string | null;
    sampleImages: string[];
  } | null;
  /** The face in the request, waiting for a decision. */
  submitted: { sampleCount: number; sampleImages: string[] };
  canAct: boolean;
}

// ─── Employee ────────────────────────────────────────────────────────────────

export const useMyFaceState = (enabled = true) =>
  useQuery<MyFaceState>({
    queryKey: ['face-state'],
    queryFn: () => api.get('/hr/attendance/face/reenroll/me').then(r => r.data),
    enabled,
  });

export const useSubmitFaceReenrollment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { descriptors: number[][]; sampleImages: string[] }) =>
      api.post('/hr/attendance/face/reenroll', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['face-state'] });
      qc.invalidateQueries({ queryKey: ['attendance-policy'] });
    },
  });
};

// ─── Reviewer (Super Admin) ──────────────────────────────────────────────────

export const useFaceReenrollmentRequests = (enabled = true) =>
  useQuery<{ data: FaceReenrollmentRequestSummary[]; total: number }>({
    queryKey: ['face-reenrollment-requests'],
    queryFn: () => api.get('/hr/attendance/face/reenroll/requests').then(r => r.data),
    enabled,
  });

export const useFaceReenrollmentRequest = (id: string | null) =>
  useQuery<FaceReenrollmentRequestDetail>({
    queryKey: ['face-reenrollment-request', id],
    queryFn: () => api.get(`/hr/attendance/face/reenroll/requests/${id}`).then(r => r.data),
    enabled: !!id,
  });

export const useDecideFaceReenrollment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'approve' | 'reject'; reason?: string }) =>
      api.post(`/hr/attendance/face/reenroll/requests/${id}/${decision}`, reason ? { reason } : {}).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['face-reenrollment-requests'] });
      qc.invalidateQueries({ queryKey: ['face-reenrollment-request'] });
      qc.invalidateQueries({ queryKey: ['face-state'] });
      qc.invalidateQueries({ queryKey: ['attendance-policy'] });
    },
  });
};
