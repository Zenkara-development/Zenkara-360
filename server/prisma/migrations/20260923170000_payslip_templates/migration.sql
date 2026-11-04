-- Phase 4: many payslip templates per org, layouts, field visibility, applicability; payslips pin a template
ALTER TABLE "payslip_templates" DROP CONSTRAINT IF EXISTS "payslip_templates_org_id_key";
DROP INDEX IF EXISTS "payslip_templates_org_id_key";
ALTER TABLE "payslip_templates"
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Default',
  ADD COLUMN "layout" TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "accent_color" TEXT,
  ADD COLUMN "header_title" TEXT NOT NULL DEFAULT 'Payslip',
  ADD COLUMN "header_note" TEXT,
  ADD COLUMN "signatory_name" TEXT,
  ADD COLUMN "signature_url" TEXT,
  ADD COLUMN "show_fields" JSONB,
  ADD COLUMN "applicability" JSONB;
CREATE INDEX IF NOT EXISTS "payslip_templates_org_id_idx" ON "payslip_templates"("org_id");

ALTER TABLE "payslips" ADD COLUMN "template_id" TEXT, ADD COLUMN "emailed_at" TIMESTAMP(3);
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "payslip_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
