-- Public web-to-lead / web-to-ticket forms.
CREATE TABLE "web_forms" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "intro" TEXT,
    "submission_count" INTEGER NOT NULL DEFAULT 0,
    "last_submission_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "web_forms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "web_forms_org_id_idx" ON "web_forms"("org_id");
ALTER TABLE "web_forms" ADD CONSTRAINT "web_forms_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
