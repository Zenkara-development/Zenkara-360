-- CreateTable
CREATE TABLE "record_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "field_values" JSONB NOT NULL,
    "custom_field_values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reply_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reply_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lines" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "record_templates_org_id_entity_type_idx" ON "record_templates"("org_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "record_templates_org_id_entity_type_name_key" ON "record_templates"("org_id", "entity_type", "name");

-- CreateIndex
CREATE INDEX "reply_templates_org_id_idx" ON "reply_templates"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "reply_templates_org_id_name_key" ON "reply_templates"("org_id", "name");

-- CreateIndex
CREATE INDEX "email_templates_org_id_idx" ON "email_templates"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_org_id_name_key" ON "email_templates"("org_id", "name");

-- CreateIndex
CREATE INDEX "quote_templates_org_id_idx" ON "quote_templates"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_templates_org_id_name_key" ON "quote_templates"("org_id", "name");

-- AddForeignKey
ALTER TABLE "record_templates" ADD CONSTRAINT "record_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_templates" ADD CONSTRAINT "quote_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
