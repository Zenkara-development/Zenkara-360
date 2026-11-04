-- Leave enhancements
ALTER TABLE "leave_types"
  ADD COLUMN "carry_forward"               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "carry_forward_max_days"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "carry_forward_expiry_months" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "allow_half_day"              BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "is_unlimited"                BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "leave_requests"
  ALTER COLUMN "days" TYPE DECIMAL(5,1),
  ADD COLUMN "half_day"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "half_day_period" TEXT,
  ADD COLUMN "applied_by"      TEXT,
  ADD COLUMN "cancelled_by"    TEXT,
  ADD COLUMN "cancelled_at"    TIMESTAMP(3),
  ADD COLUMN "cancel_reason"   TEXT;

CREATE TABLE "leave_balance_adjustments" (
  "id"            TEXT NOT NULL,
  "org_id"        TEXT NOT NULL,
  "user_id"       TEXT NOT NULL,
  "leave_type_id" TEXT NOT NULL,
  "year"          INTEGER NOT NULL,
  "days"          DECIMAL(5,1) NOT NULL,
  "reason"        TEXT,
  "created_by"    TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_balance_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leave_balance_adjustments_org_id_user_id_year_idx" ON "leave_balance_adjustments"("org_id", "user_id", "year");
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Attendance policy engine
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'UNPAID_LEAVE', 'WFH', 'HOLIDAY', 'WEEK_OFF', 'LOP');

CREATE TABLE "attendance_policy_groups" (
  "id"                            TEXT NOT NULL,
  "org_id"                        TEXT NOT NULL,
  "name"                          TEXT NOT NULL,
  "is_default"                    BOOLEAN NOT NULL DEFAULT false,
  "is_active"                     BOOLEAN NOT NULL DEFAULT true,
  "shift_start"                   TEXT NOT NULL DEFAULT '09:00',
  "shift_end"                     TEXT NOT NULL DEFAULT '18:00',
  "timezone"                      TEXT,
  "grace_minutes"                 INTEGER NOT NULL DEFAULT 15,
  "late_bands"                    JSONB,
  "min_full_day_minutes"          INTEGER NOT NULL DEFAULT 480,
  "min_half_day_minutes"          INTEGER NOT NULL DEFAULT 240,
  "early_departure_grace_minutes" INTEGER NOT NULL DEFAULT 15,
  "early_departure_status"        TEXT NOT NULL DEFAULT 'NONE',
  "overtime_after_minutes"        INTEGER NOT NULL DEFAULT 0,
  "overtime_min_minutes"          INTEGER NOT NULL DEFAULT 30,
  "late_allowed_per_month"        INTEGER NOT NULL DEFAULT 3,
  "late_conversion_every"         INTEGER NOT NULL DEFAULT 3,
  "late_conversion_unit"          TEXT NOT NULL DEFAULT 'HALF_DAY',
  "weekly_offs"                   INTEGER[] DEFAULT ARRAY[0, 6]::INTEGER[],
  "assume_shift_end_on_missing_checkout" BOOLEAN NOT NULL DEFAULT false,
  "applicability"                 JSONB,
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_policy_groups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_policy_groups_org_id_idx" ON "attendance_policy_groups"("org_id");
ALTER TABLE "attendance_policy_groups" ADD CONSTRAINT "attendance_policy_groups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "holidays" (
  "id"           TEXT NOT NULL,
  "org_id"       TEXT NOT NULL,
  "date"         DATE NOT NULL,
  "name"         TEXT NOT NULL,
  "location_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "is_optional"  BOOLEAN NOT NULL DEFAULT false,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "holidays_org_id_date_name_key" ON "holidays"("org_id", "date", "name");
CREATE INDEX "holidays_org_id_date_idx" ON "holidays"("org_id", "date");
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "attendance_days" (
  "id"               TEXT NOT NULL,
  "org_id"           TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "date"             DATE NOT NULL,
  "status"           "AttendanceStatus" NOT NULL,
  "source"           TEXT NOT NULL DEFAULT 'COMPUTED',
  "policy_group_id"  TEXT,
  "first_in_at"      TIMESTAMP(3),
  "last_out_at"      TIMESTAMP(3),
  "worked_minutes"   INTEGER NOT NULL DEFAULT 0,
  "late_minutes"     INTEGER NOT NULL DEFAULT 0,
  "early_minutes"    INTEGER NOT NULL DEFAULT 0,
  "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
  "paid_fraction"    DECIMAL(3,2) NOT NULL DEFAULT 1,
  "leave_request_id" TEXT,
  "reason"           TEXT,
  "notes"            TEXT,
  "updated_by"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_days_user_id_date_key" ON "attendance_days"("user_id", "date");
CREATE INDEX "attendance_days_org_id_date_idx" ON "attendance_days"("org_id", "date");
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_policy_group_id_fkey" FOREIGN KEY ("policy_group_id") REFERENCES "attendance_policy_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "attendance_audits" (
  "id"          TEXT NOT NULL,
  "org_id"      TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "date"        DATE,
  "entity_type" TEXT NOT NULL,
  "entity_id"   TEXT,
  "action"      TEXT NOT NULL,
  "before"      JSONB,
  "after"       JSONB,
  "reason"      TEXT,
  "changed_by"  TEXT NOT NULL,
  "changed_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_audits_org_id_user_id_changed_at_idx" ON "attendance_audits"("org_id", "user_id", "changed_at");
ALTER TABLE "attendance_audits" ADD CONSTRAINT "attendance_audits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_audits" ADD CONSTRAINT "attendance_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_audits" ADD CONSTRAINT "attendance_audits_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
