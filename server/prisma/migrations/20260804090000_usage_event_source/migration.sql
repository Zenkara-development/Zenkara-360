-- Distinguish "org's own connected account" from "platform fallback" for
-- WHATSAPP_SEND/EMAIL_SEND usage events (see UsageEvent comment in schema.prisma).
-- Nullable + no backfill needed: existing rows predate the distinction and are
-- left as NULL (treated as "own" by the read helpers in utils/usageTracking.ts,
-- since that's what every WHATSAPP_SEND row before this migration actually was).
ALTER TABLE "usage_events" ADD COLUMN "source" TEXT;
