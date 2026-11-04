-- CreateTable
CREATE TABLE "business_contexts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "industry" TEXT,
    "company_desc" TEXT,
    "terminology" JSONB,
    "custom_system" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_ai_functions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system_prompt" TEXT NOT NULL,
    "input_schema" JSONB NOT NULL,
    "output_type" TEXT NOT NULL DEFAULT 'text',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_ai_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_scripts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "field_target" TEXT,
    "script" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_contexts_org_id_key" ON "business_contexts"("org_id");

-- CreateIndex
CREATE INDEX "custom_ai_functions_org_id_idx" ON "custom_ai_functions"("org_id");

-- CreateIndex
CREATE INDEX "custom_scripts_org_id_entity_type_trigger_idx" ON "custom_scripts"("org_id", "entity_type", "trigger");

-- AddForeignKey
ALTER TABLE "business_contexts" ADD CONSTRAINT "business_contexts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_ai_functions" ADD CONSTRAINT "custom_ai_functions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_scripts" ADD CONSTRAINT "custom_scripts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
