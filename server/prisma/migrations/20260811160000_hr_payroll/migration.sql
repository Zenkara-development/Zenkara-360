-- HR: Payroll (salary structures, payroll runs, payslips). See schema.prisma
-- comments on each model.

-- SalaryStructure
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "basic" DECIMAL(12,2) NOT NULL,
    "hra" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pf_percent" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "professional_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "salary_structures_org_id_user_id_idx" ON "salary_structures"("org_id", "user_id");
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PayrollRun
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "run_by" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_runs_org_id_month_year_key" ON "payroll_runs"("org_id", "month", "year");
CREATE INDEX "payroll_runs_org_id_idx" ON "payroll_runs"("org_id");
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_run_by_fkey"
    FOREIGN KEY ("run_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payslip
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "salary_structure_id" TEXT,
    "payslip_number" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "basic" DECIMAL(12,2) NOT NULL,
    "hra" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL,
    "gross_pay" DECIMAL(12,2) NOT NULL,
    "pf" DECIMAL(12,2) NOT NULL,
    "professional_tax" DECIMAL(12,2) NOT NULL,
    "other_deductions" DECIMAL(12,2) NOT NULL,
    "total_deductions" DECIMAL(12,2) NOT NULL,
    "net_pay" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payslips_org_id_user_id_month_year_key" ON "payslips"("org_id", "user_id", "month", "year");
CREATE INDEX "payslips_org_id_month_year_idx" ON "payslips"("org_id", "month", "year");
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_fkey"
    FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_salary_structure_id_fkey"
    FOREIGN KEY ("salary_structure_id") REFERENCES "salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
