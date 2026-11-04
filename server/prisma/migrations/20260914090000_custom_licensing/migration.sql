-- Subscription is now the single source of truth for an org's plan.
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "plan";

-- Custom licence + payment-state fields
ALTER TABLE "subscriptions"
  ADD COLUMN "interval"               TEXT        NOT NULL DEFAULT 'month',
  ADD COLUMN "features"               TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "amount_cents"           INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN "grace_until"            TIMESTAMP(3),
  ADD COLUMN "last_payment_failed_at" TIMESTAMP(3);

-- Operator-editable licence pricing (Platform Admin → Pricing)
ALTER TABLE "platform_settings" ADD COLUMN "pricing" JSONB;
