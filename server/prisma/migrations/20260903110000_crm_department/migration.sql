-- Department support for CRM: leads and deals can be worked by a department.
ALTER TABLE "leads" ADD COLUMN "department_id" TEXT;
ALTER TABLE "leads" ADD CONSTRAINT "leads_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deals" ADD COLUMN "department_id" TEXT;
ALTER TABLE "deals" ADD CONSTRAINT "deals_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "leads_org_id_department_id_idx" ON "leads"("org_id", "department_id");
CREATE INDEX "deals_org_id_department_id_idx" ON "deals"("org_id", "department_id");
