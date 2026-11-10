-- Face ID re-enrolment requests (HR-005).
--
-- An employee who already has an active Face ID cannot replace or remove it
-- directly. Instead they submit a request; a Super Admin approves or rejects
-- it. The request lives in its own table so the *pending* samples are kept
-- strictly separate from the *active* enrolment — the old face keeps working
-- for attendance while the request waits, and is only retired once an
-- approval transaction succeeds.
--
-- Every enrolment sample image is now stored, not just one reference
-- thumbnail, so a reviewer can compare the old and the new samples by eye.

-- Keep every enrolment sample image, not only the single reference selfie.
ALTER TABLE "face_enrollments" ADD COLUMN "sample_images" JSONB;

CREATE TABLE "face_reenrollment_requests" (
  "id"               TEXT NOT NULL,
  "org_id"           TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'PENDING',
  "descriptors"      JSONB NOT NULL,
  "sample_images"    JSONB NOT NULL,
  "samples"          INTEGER NOT NULL DEFAULT 0,
  "reference_selfie" TEXT,
  "rejection_reason" TEXT,
  "reviewed_by"      TEXT,
  "reviewed_at"      TIMESTAMP(3),
  "decided_at"       TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "face_reenrollment_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "face_reenrollment_requests_org_id_status_idx" ON "face_reenrollment_requests"("org_id", "status");
CREATE INDEX "face_reenrollment_requests_user_id_status_idx" ON "face_reenrollment_requests"("user_id", "status");

ALTER TABLE "face_reenrollment_requests" ADD CONSTRAINT "face_reenrollment_requests_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "face_reenrollment_requests" ADD CONSTRAINT "face_reenrollment_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "face_reenrollment_requests" ADD CONSTRAINT "face_reenrollment_requests_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most ONE pending re-enrolment request per employee. The application
-- checks this too, but two browser tabs submitting at the same moment would
-- both pass that check — this partial unique index is what actually makes it
-- impossible. Decided requests (APPROVED / REJECTED) are kept for audit and
-- are not covered by the constraint.
CREATE UNIQUE INDEX "face_reenrollment_requests_one_pending_per_user"
  ON "face_reenrollment_requests"("user_id")
  WHERE "status" = 'PENDING';
