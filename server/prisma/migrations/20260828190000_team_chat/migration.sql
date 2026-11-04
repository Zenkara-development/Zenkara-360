-- Team chat: DM + record-attached threads, participants with read cursors,
-- messages (authorId NULL = the @ai assistant).

CREATE TABLE "chat_threads" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dm_key" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "last_message_at" TIMESTAMP(3),
    "pending_plan" JSONB,
    "pending_plan_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_participants" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3),
    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author_id" TEXT,
    "is_assistant" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_threads_org_id_dm_key_key" ON "chat_threads"("org_id", "dm_key");
CREATE UNIQUE INDEX "chat_threads_org_id_entity_type_entity_id_key" ON "chat_threads"("org_id", "entity_type", "entity_id");
CREATE INDEX "chat_threads_org_id_last_message_at_idx" ON "chat_threads"("org_id", "last_message_at");
CREATE UNIQUE INDEX "chat_participants_thread_id_user_id_key" ON "chat_participants"("thread_id", "user_id");
CREATE INDEX "chat_participants_user_id_idx" ON "chat_participants"("user_id");
CREATE INDEX "chat_messages_thread_id_created_at_idx" ON "chat_messages"("thread_id", "created_at");

ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
