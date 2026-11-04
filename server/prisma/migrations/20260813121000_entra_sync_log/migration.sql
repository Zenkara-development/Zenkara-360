-- Entra ID SSO phase 3: scheduled sync run history. See schema.prisma
-- comment on DirectorySyncLog.

CREATE TABLE "directory_sync_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "users_created" INTEGER NOT NULL DEFAULT 0,
    "users_deactivated" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,

    CONSTRAINT "directory_sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "directory_sync_logs_org_id_started_at_idx" ON "directory_sync_logs"("org_id", "started_at");
ALTER TABLE "directory_sync_logs" ADD CONSTRAINT "directory_sync_logs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
