-- Postgres-backed retry queue (see utils/jobQueue.ts). Deliberately not a
-- Redis dependency — matches the existing setInterval + DB-poll convention
-- used by scheduler.ts / slaMonitor.ts / dateAutomation.ts.
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "background_jobs_status_next_attempt_at_idx" ON "background_jobs"("status", "next_attempt_at");
CREATE INDEX "background_jobs_org_id_idx" ON "background_jobs"("org_id");
