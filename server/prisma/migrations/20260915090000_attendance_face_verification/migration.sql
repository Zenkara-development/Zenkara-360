-- Face verification at attendance check-in
ALTER TABLE "attendance_records"
  ADD COLUMN "check_in_face_ok"        BOOLEAN,
  ADD COLUMN "check_in_face_distance"  DOUBLE PRECISION,
  ADD COLUMN "check_in_selfie"         TEXT,
  ADD COLUMN "check_in_passed"         BOOLEAN,
  ADD COLUMN "check_out_face_ok"       BOOLEAN,
  ADD COLUMN "check_out_face_distance" DOUBLE PRECISION,
  ADD COLUMN "check_out_selfie"        TEXT,
  ADD COLUMN "check_out_passed"        BOOLEAN,
  ADD COLUMN "check_out_source"        TEXT,
  ADD COLUMN "last_seen_at"            TIMESTAMP(3),
  ADD COLUMN "last_seen_lat"           DOUBLE PRECISION,
  ADD COLUMN "last_seen_lng"           DOUBLE PRECISION,
  ADD COLUMN "last_seen_inside"        BOOLEAN,
  ADD COLUMN "outside_since"           TIMESTAMP(3),
  ADD COLUMN "last_nudged_at"          TIMESTAMP(3);

CREATE TABLE "attendance_policies" (
  "id"                         TEXT NOT NULL,
  "org_id"                     TEXT NOT NULL,
  "check_in_rule"              JSONB,
  "check_out_rule"             JSONB,
  "auto_checkout_on_leave"     BOOLEAN NOT NULL DEFAULT false,
  "auto_checkout_after_minutes" INTEGER NOT NULL DEFAULT 5,
  "heartbeat_timeout_minutes"  INTEGER NOT NULL DEFAULT 0,
  "share_live_location"        BOOLEAN NOT NULL DEFAULT false,
  "location_retention_days"    INTEGER NOT NULL DEFAULT 30,
  "nudge_after_minutes"        INTEGER NOT NULL DEFAULT 10,
  "nudge_repeat_minutes"       INTEGER NOT NULL DEFAULT 30,
  "face_match_threshold"       DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "keep_check_in_selfie"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_policies_org_id_key" ON "attendance_policies"("org_id");
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "face_enrollments" (
  "id"               TEXT NOT NULL,
  "org_id"           TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "descriptors"      JSONB NOT NULL,
  "samples"          INTEGER NOT NULL DEFAULT 0,
  "reference_selfie" TEXT,
  "enrolled_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "face_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "face_enrollments_user_id_key" ON "face_enrollments"("user_id");
CREATE INDEX "face_enrollments_org_id_idx" ON "face_enrollments"("org_id");
ALTER TABLE "face_enrollments" ADD CONSTRAINT "face_enrollments_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "face_enrollments" ADD CONSTRAINT "face_enrollments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Live location pings (manager live map + day trail)
CREATE TABLE "attendance_location_pings" (
  "id"        TEXT NOT NULL,
  "org_id"    TEXT NOT NULL,
  "user_id"   TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lat"       DOUBLE PRECISION NOT NULL,
  "lng"       DOUBLE PRECISION NOT NULL,
  "accuracy"  DOUBLE PRECISION,
  "inside"    BOOLEAN,
  CONSTRAINT "attendance_location_pings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_location_pings_org_id_at_idx" ON "attendance_location_pings"("org_id", "at");
CREATE INDEX "attendance_location_pings_user_id_at_idx" ON "attendance_location_pings"("user_id", "at");
ALTER TABLE "attendance_location_pings" ADD CONSTRAINT "attendance_location_pings_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_location_pings" ADD CONSTRAINT "attendance_location_pings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_location_pings" ADD CONSTRAINT "attendance_location_pings_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
