-- Phase 2 of the platform play: custom modules gain pipelines (stages),
-- module-to-module relation fields, and configurable list columns.
ALTER TABLE "custom_modules" ADD COLUMN "stages" JSONB;
ALTER TABLE "custom_modules" ADD COLUMN "list_columns" JSONB;
ALTER TABLE "custom_module_fields" ADD COLUMN "relation_module_id" TEXT;
ALTER TABLE "custom_module_records" ADD COLUMN "stage" TEXT;
CREATE INDEX "custom_module_records_module_id_stage_idx" ON "custom_module_records"("module_id", "stage");
