-- Lead follow-up activities
ALTER TABLE "activities" ADD COLUMN "lead_id" TEXT;
CREATE INDEX "activities_lead_id_idx" ON "activities"("lead_id");
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: custom_modules
CREATE TABLE "custom_modules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Layers',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_modules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_modules_org_id_slug_key" ON "custom_modules"("org_id", "slug");
CREATE INDEX "custom_modules_org_id_idx" ON "custom_modules"("org_id");

ALTER TABLE "custom_modules" ADD CONSTRAINT "custom_modules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: custom_module_fields
CREATE TABLE "custom_module_fields" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_module_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_module_fields_module_id_field_key_key" ON "custom_module_fields"("module_id", "field_key");
CREATE INDEX "custom_module_fields_module_id_idx" ON "custom_module_fields"("module_id");

ALTER TABLE "custom_module_fields" ADD CONSTRAINT "custom_module_fields_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "custom_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: custom_module_records
CREATE TABLE "custom_module_records" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "external_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_module_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_module_records_module_id_external_id_key" ON "custom_module_records"("module_id", "external_id");
CREATE INDEX "custom_module_records_module_id_idx" ON "custom_module_records"("module_id");
CREATE INDEX "custom_module_records_org_id_idx" ON "custom_module_records"("org_id");

ALTER TABLE "custom_module_records" ADD CONSTRAINT "custom_module_records_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "custom_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_module_records" ADD CONSTRAINT "custom_module_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: external_sync_configs
CREATE TABLE "external_sync_configs" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "auth_type" TEXT NOT NULL DEFAULT 'NONE',
    "auth_header_name" TEXT,
    "auth_value" TEXT,
    "poll_interval_min" INTEGER NOT NULL DEFAULT 15,
    "record_path" TEXT,
    "external_id_field" TEXT,
    "field_mapping" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_error" TEXT,
    "last_record_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_sync_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_sync_configs_module_id_key" ON "external_sync_configs"("module_id");

ALTER TABLE "external_sync_configs" ADD CONSTRAINT "external_sync_configs_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "custom_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
