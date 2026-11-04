-- Configurable SLA breach recipient — see utils/slaMonitor.ts

ALTER TABLE "sla_policies" ADD COLUMN "notify_user_id" TEXT;

ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_notify_user_id_fkey" FOREIGN KEY ("notify_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
