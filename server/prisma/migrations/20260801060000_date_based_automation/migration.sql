-- Date-driven follow-up automations (birthday wishes, appointment reminders,
-- service-due reminders, thank-you-after-visit) — see utils/dateAutomation.ts
-- for the poller and workflow-engine.ts for the DATE_FIELD_REACHED trigger.

ALTER TABLE "contacts" ADD COLUMN "date_of_birth" TIMESTAMP(3);

ALTER TABLE "workflow_rules" ADD COLUMN "date_config" JSONB;
