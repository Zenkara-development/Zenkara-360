-- Singleton table holding the platform-wide email/WhatsApp fallback config,
-- editable live from the Platform Admin console instead of only via Render
-- env vars. See PlatformSettings comment in schema.prisma.
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "resend_api_key" TEXT,
    "resend_from" TEXT,
    "smtp_host" TEXT,
    "smtp_port" INTEGER,
    "smtp_user" TEXT,
    "smtp_pass" TEXT,
    "smtp_from" TEXT,
    "twilio_account_sid" TEXT,
    "twilio_auth_token" TEXT,
    "twilio_from_number" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
