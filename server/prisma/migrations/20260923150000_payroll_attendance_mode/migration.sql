-- Phase 3: payroll runs record whether attendance drove the day counts
ALTER TABLE "payroll_runs" ADD COLUMN "attendance_mode" TEXT NOT NULL DEFAULT 'ATTENDANCE';
