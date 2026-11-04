-- Secret token for server-to-server form intake (webhooks / Apps Script).
ALTER TABLE "web_forms" ADD COLUMN "intake_token" TEXT;
CREATE UNIQUE INDEX "web_forms_intake_token_key" ON "web_forms"("intake_token");
