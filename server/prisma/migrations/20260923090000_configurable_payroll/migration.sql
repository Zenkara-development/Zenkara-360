-- Configurable payroll: salary components, payroll cycles, employee salaries, payslip lines

CREATE TYPE "SalaryComponentCategory" AS ENUM ('EARNING', 'DEDUCTION', 'REIMBURSEMENT', 'EMPLOYER_CONTRIBUTION');
CREATE TYPE "SalaryCalcType" AS ENUM ('FIXED', 'PERCENT', 'FORMULA');
CREATE TYPE "PayrollFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM');

CREATE TABLE "salary_components" (
  "id"               TEXT NOT NULL,
  "org_id"           TEXT NOT NULL,
  "code"             TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "category"         "SalaryComponentCategory" NOT NULL,
  "calc_type"        "SalaryCalcType" NOT NULL DEFAULT 'FIXED',
  "amount"           DECIMAL(12,2),
  "percent"          DECIMAL(7,3),
  "percent_of"       TEXT,
  "formula"          TEXT,
  "statutory"        TEXT,
  "statutory_config" JSONB,
  "prorate"          BOOLEAN NOT NULL DEFAULT true,
  "taxable"          BOOLEAN NOT NULL DEFAULT true,
  "show_on_payslip"  BOOLEAN NOT NULL DEFAULT true,
  "display_order"    INTEGER NOT NULL DEFAULT 0,
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "applicability"    JSONB,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "salary_components_org_id_code_key" ON "salary_components"("org_id", "code");
CREATE INDEX "salary_components_org_id_is_active_idx" ON "salary_components"("org_id", "is_active");
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payroll_cycles" (
  "id"            TEXT NOT NULL,
  "org_id"        TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "frequency"     "PayrollFrequency" NOT NULL DEFAULT 'MONTHLY',
  "start_weekday" INTEGER,
  "anchor_date"   DATE,
  "length_days"   INTEGER,
  "is_default"    BOOLEAN NOT NULL DEFAULT false,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_cycles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_cycles_org_id_idx" ON "payroll_cycles"("org_id");
ALTER TABLE "payroll_cycles" ADD CONSTRAINT "payroll_cycles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "employee_salaries" (
  "id"               TEXT NOT NULL,
  "org_id"           TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "payroll_cycle_id" TEXT,
  "currency"         TEXT NOT NULL DEFAULT 'INR',
  "ctc_annual"       DECIMAL(14,2),
  "overrides"        JSONB NOT NULL DEFAULT '{}',
  "effective_from"   DATE NOT NULL,
  "is_active"        BOOLEAN NOT NULL DEFAULT true,
  "notes"            TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_salaries_org_id_user_id_is_active_idx" ON "employee_salaries"("org_id", "user_id", "is_active");
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_payroll_cycle_id_fkey" FOREIGN KEY ("payroll_cycle_id") REFERENCES "payroll_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payroll runs: cycle + period + draft status
ALTER TABLE "payroll_runs"
  ADD COLUMN "payroll_cycle_id" TEXT,
  ADD COLUMN "period_start"     DATE,
  ADD COLUMN "period_end"       DATE,
  ADD COLUMN "finalized_at"     TIMESTAMP(3);
UPDATE "payroll_runs" SET
  "period_start" = make_date("year", "month", 1),
  "period_end"   = (make_date("year", "month", 1) + INTERVAL '1 month - 1 day')::date,
  "finalized_at" = "run_at";
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_org_id_month_year_key";
DROP INDEX IF EXISTS "payroll_runs_org_id_month_year_key";
DROP INDEX IF EXISTS "payroll_runs_org_id_idx";
CREATE UNIQUE INDEX "payroll_runs_org_id_payroll_cycle_id_period_start_key" ON "payroll_runs"("org_id", "payroll_cycle_id", "period_start");
CREATE INDEX "payroll_runs_org_id_year_month_idx" ON "payroll_runs"("org_id", "year", "month");
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payroll_cycle_id_fkey" FOREIGN KEY ("payroll_cycle_id") REFERENCES "payroll_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payslips: component-based fields
ALTER TABLE "payslips"
  ADD COLUMN "employee_salary_id"     TEXT,
  ADD COLUMN "period_start"           DATE,
  ADD COLUMN "period_end"             DATE,
  ADD COLUMN "currency"               TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "working_days"           DECIMAL(5,2),
  ADD COLUMN "present_days"           DECIMAL(5,2),
  ADD COLUMN "paid_days"              DECIMAL(5,2),
  ADD COLUMN "leave_days"             DECIMAL(5,2),
  ADD COLUMN "lop_days"               DECIMAL(5,2),
  ADD COLUMN "half_days"              DECIMAL(5,2),
  ADD COLUMN "overtime_hours"         DECIMAL(6,2),
  ADD COLUMN "total_earnings"         DECIMAL(12,2),
  ADD COLUMN "total_reimbursements"   DECIMAL(12,2),
  ADD COLUMN "employer_contributions" DECIMAL(12,2),
  ADD COLUMN "attendance_summary"     JSONB;
UPDATE "payslips" SET "period_start" = make_date("year", "month", 1), "period_end" = (make_date("year", "month", 1) + INTERVAL '1 month - 1 day')::date, "total_earnings" = "gross_pay";
ALTER TABLE "payslips" DROP CONSTRAINT IF EXISTS "payslips_org_id_user_id_month_year_key";
DROP INDEX IF EXISTS "payslips_org_id_user_id_month_year_key";
CREATE UNIQUE INDEX "payslips_org_id_user_id_payroll_run_id_key" ON "payslips"("org_id", "user_id", "payroll_run_id");
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_salary_id_fkey" FOREIGN KEY ("employee_salary_id") REFERENCES "employee_salaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payslip_lines" (
  "id"              TEXT NOT NULL,
  "payslip_id"      TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "category"        "SalaryComponentCategory" NOT NULL,
  "amount"          DECIMAL(12,2) NOT NULL,
  "basis"           TEXT,
  "show_on_payslip" BOOLEAN NOT NULL DEFAULT true,
  "display_order"   INTEGER NOT NULL DEFAULT 0,
  "adjusted"        BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "payslip_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payslip_lines_payslip_id_idx" ON "payslip_lines"("payslip_id");
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lines for existing payslips so the new print view renders them
INSERT INTO "payslip_lines" ("id", "payslip_id", "code", "name", "category", "amount", "basis", "display_order")
SELECT 'pl_' || p."id" || '_' || l.code, p."id", l.code, l.name, l.category::"SalaryComponentCategory", l.amount, 'migrated', l.ord
FROM "payslips" p
CROSS JOIN LATERAL (VALUES
  ('BASIC', 'Basic Salary', 'EARNING', p."basic", 10),
  ('HRA', 'House Rent Allowance', 'EARNING', p."hra", 20),
  ('ALLOWANCES', 'Other Allowances', 'EARNING', p."allowances", 30),
  ('PF_EMP', 'Provident Fund', 'DEDUCTION', p."pf", 100),
  ('PT', 'Professional Tax', 'DEDUCTION', p."professional_tax", 110),
  ('OTHER_DED', 'Other Deductions', 'DEDUCTION', p."other_deductions", 120)
) AS l(code, name, category, amount, ord)
WHERE l.amount <> 0;

-- Migrate active legacy salary structures into employee salaries (component
-- catalogue rows are created lazily per org by ensureDefaultComponents()).
INSERT INTO "employee_salaries" ("id", "org_id", "user_id", "overrides", "effective_from", "is_active", "notes", "created_at", "updated_at")
SELECT 'es_' || s."id", s."org_id", s."user_id",
  jsonb_build_object(
    'BASIC',      jsonb_build_object('amount', s."basic"),
    'HRA',        jsonb_build_object('amount', s."hra"),
    'ALLOWANCES', jsonb_build_object('amount', s."allowances"),
    'PF_EMP',     jsonb_build_object('percent', s."pf_percent"),
    'PT',         jsonb_build_object('amount', s."professional_tax"),
    'OTHER_DED',  jsonb_build_object('amount', s."other_deductions")
  ),
  s."effective_from", true, 'Migrated from legacy salary structure', s."created_at", CURRENT_TIMESTAMP
FROM "salary_structures" s
WHERE s."is_active" = true;
