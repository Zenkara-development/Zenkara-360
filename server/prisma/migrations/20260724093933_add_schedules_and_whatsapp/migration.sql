-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_configs" ADD COLUMN     "notify_number" TEXT;

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "message" TEXT NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "custom_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "last_error" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedules_org_id_entity_type_entity_id_idx" ON "schedules"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "schedules_status_due_at_idx" ON "schedules"("status", "due_at");

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
