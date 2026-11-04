-- Per-org license limits set by the platform operator:
-- storage quota override (GB) and monthly AI token allowance.
ALTER TABLE "subscriptions" ADD COLUMN "storage_quota_override_gb" INTEGER;
ALTER TABLE "subscriptions" ADD COLUMN "ai_token_limit_monthly" INTEGER;
