-- HR Payroll: org-designed payslip letterhead template (see schema.prisma
-- comment on PayslipTemplate).

CREATE TABLE "payslip_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "company_name" TEXT,
    "company_address" TEXT,
    "logo_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#2563eb',
    "footer_note" TEXT,
    "show_signature" BOOLEAN NOT NULL DEFAULT true,
    "signature_label" TEXT NOT NULL DEFAULT 'Authorized Signatory',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payslip_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payslip_templates_org_id_key" ON "payslip_templates"("org_id");
ALTER TABLE "payslip_templates" ADD CONSTRAINT "payslip_templates_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
