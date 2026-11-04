-- Email-sync dedupe queries messages by external_id (the RFC Message-ID
-- header) once per synced email. The column was unindexed, so every inbound
-- email cost a sequential scan of the whole messages table — sync got slower
-- as the product succeeded. Plain index (not unique): the same Message-ID
-- legitimately appears once per org that received the email; uniqueness is
-- enforced per-org by the application's scoped dedupe check.

-- CreateIndex
CREATE INDEX "messages_external_id_idx" ON "messages"("external_id");
