-- Custom modules: pick which sidebar section (CRM / IT Desk / HR / Admin) a
-- module's nav entry appears under. See schema.prisma's comment on
-- CustomModule.navSection.

ALTER TABLE "custom_modules" ADD COLUMN "nav_section" TEXT NOT NULL DEFAULT 'CRM';
