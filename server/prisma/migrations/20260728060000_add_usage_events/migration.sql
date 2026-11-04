-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_events_org_id_type_created_at_idx" ON "usage_events"("org_id", "type", "created_at");

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
