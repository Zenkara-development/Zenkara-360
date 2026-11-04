-- New platform features: staff password reset, Google SSO linking, per-user
-- Google Calendar sync, quote e-signature capture, and portal live chat
-- (Conversation.portalUserId). See schema.prisma comments on each model/field.

-- User: Google SSO linking
ALTER TABLE "users" ADD COLUMN "google_id" TEXT;
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- PasswordResetToken
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CalendarConnection
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE_CALENDAR',
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "connected_email" TEXT,
    "sync_activities" BOOLEAN NOT NULL DEFAULT true,
    "sync_tickets" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_connections_user_id_key" ON "calendar_connections"("user_id");
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quote: e-signature capture
ALTER TABLE "quotes" ADD COLUMN "signer_name" TEXT;
ALTER TABLE "quotes" ADD COLUMN "signer_email" TEXT;
ALTER TABLE "quotes" ADD COLUMN "signed_at" TIMESTAMP(3);
ALTER TABLE "quotes" ADD COLUMN "signer_ip" TEXT;

-- Conversation: link live-chat conversations to a PortalUser
ALTER TABLE "conversations" ADD COLUMN "portal_user_id" TEXT;
CREATE INDEX "conversations_portal_user_id_idx" ON "conversations"("portal_user_id");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_portal_user_id_fkey"
    FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
