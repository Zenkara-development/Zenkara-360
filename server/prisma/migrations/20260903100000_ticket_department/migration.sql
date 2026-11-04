-- Tickets can be raised to a department (HR Department model).
ALTER TABLE "tickets" ADD COLUMN "department_id" TEXT;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tickets_org_id_department_id_idx" ON "tickets"("org_id", "department_id");
