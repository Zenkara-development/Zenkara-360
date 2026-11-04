import { Response, NextFunction } from 'express';
import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/authenticate';
import { PLANS, FeatureKey, PlanKey, isPlanKey } from './stripe';
import { normaliseModules, getPricingConfig, DEFAULT_PRICING, PricingConfig } from './pricing';

// Every internal role counts against a plan's seat limit EXCEPT plain
// EMPLOYEE — those are staff who just submit requests internally (not
// technicians, sales reps, managers, or admins actually working the
// platform), so they're free and unlimited. Everyone else — SUPER_ADMIN,
// CRM_MANAGER, SALES_REP, IT_MANAGER, IT_AGENT — is a billable seat.
const UNMETERED_ROLES = new Set(['EMPLOYEE']);

export function isMeteredRole(role: string): boolean {
  return !UNMETERED_ROLES.has(role);
}

/** Same default-row pattern billing.controller.ts uses — never assume a
 * Subscription row already exists for an org. */
async function getOrCreateSubscription(orgId: string) {
  return prisma.subscription.upsert({
    where: { orgId },
    create: { orgId, plan: 'FREE', status: 'active', seats: 5 },
    update: {},
  });
}

// ─── Effective licence (plan × payment state) ────────────────────────────────
//
// Everything below (seats, features, storage) must read the org's licence
// through getEffectiveLicense() rather than Subscription.plan directly, so
// that Stripe's payment state is honoured everywhere in one place:
//
//   active / trialing            → full paid entitlements
//   past_due / incomplete        → paid entitlements continue during the grace
//                                  window (graceUntil, set by invoice.payment_failed,
//                                  else currentPeriodEnd + gracePeriodDays), then FREE
//   canceled / unpaid / paused   → FREE immediately
//   active but currentPeriodEnd stale past the grace window → FREE
//
// "FREE" here means FREE entitlements (seats/features/storage). Existing users,
// rules and files are never touched — the grandfathering rules in the licensing
// spec still apply; the org simply can't add beyond FREE limits until it pays.

export type LicenseAccess = 'full' | 'grace' | 'lapsed';

export interface EffectiveLicense {
  orgId: string;
  /** Plan on the row */
  plan: PlanKey;
  /** Plan whose entitlements actually apply right now */
  effectivePlan: PlanKey;
  status: string;
  seats: number;
  features: FeatureKey[];
  storageQuotaGB: number;
  interval: string;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  access: LicenseAccess;
  /** Human-readable explanation when access !== 'full' */
  reason: string | null;
}

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const LAPSED_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

type SubRow = {
  orgId: string; plan: string; status: string; seats: number; features: string[]; interval: string;
  currentPeriodEnd: Date | null; graceUntil: Date | null; cancelAtPeriodEnd: boolean;
  storageQuotaOverrideGb: number | null;
};

/** Pure evaluation — exported so it can be unit-tested without a database. */
export function evaluateLicense(sub: SubRow, now = new Date(), cfg: PricingConfig = DEFAULT_PRICING): EffectiveLicense {
  const plan: PlanKey = isPlanKey(sub.plan) ? sub.plan : 'FREE';
  const base = {
    orgId: sub.orgId, plan, status: sub.status, interval: sub.interval,
    currentPeriodEnd: sub.currentPeriodEnd, graceUntil: sub.graceUntil, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };

  const paidFeatures: FeatureKey[] = plan === 'CUSTOM'
    ? (normaliseModules(sub.features).filter(k => k !== 'hosted_storage') as FeatureKey[])
    : [...PLANS[plan].features];
  const paidStorage = sub.storageQuotaOverrideGb ?? (plan === 'CUSTOM'
    ? (sub.features.includes('hosted_storage') ? cfg.customStorageGb : 0)
    : PLANS[plan].storageQuotaGB);

  const full: EffectiveLicense = { ...base, effectivePlan: plan, seats: sub.seats, features: paidFeatures, storageQuotaGB: paidStorage, access: 'full', reason: null };
  const lapsed = (reason: string): EffectiveLicense => ({
    ...base, effectivePlan: 'FREE', seats: PLANS.FREE.seats, features: [...PLANS.FREE.features],
    // An explicit operator override still wins on a lapsed org (it is a deliberate comp)
    storageQuotaGB: sub.storageQuotaOverrideGb ?? PLANS.FREE.storageQuotaGB, access: 'lapsed', reason,
  });

  if (plan === 'FREE') return { ...full, seats: PLANS.FREE.seats };
  if (LAPSED_STATUSES.has(sub.status)) return lapsed(`Your subscription is ${sub.status}.`);

  const graceEnd = sub.graceUntil ?? (sub.currentPeriodEnd ? addDays(sub.currentPeriodEnd, cfg.gracePeriodDays) : null);

  if (sub.status === 'past_due' || sub.status === 'incomplete') {
    if (graceEnd && now <= graceEnd) {
      return { ...full, access: 'grace', reason: `Your last payment failed. Update your payment method before ${graceEnd.toDateString()} to keep ${PLANS[plan].name} features.` };
    }
    return lapsed('Your last payment failed and the grace period has ended.');
  }

  if (ACTIVE_STATUSES.has(sub.status)) {
    if (sub.currentPeriodEnd && now > addDays(sub.currentPeriodEnd, cfg.gracePeriodDays)) {
      return lapsed('Your subscription period ended and was not renewed.');
    }
    return full;
  }

  return lapsed(`Your subscription status "${sub.status}" is not active.`);
}

const CACHE_TTL_MS = 30_000;
const licenseCache = new Map<string, { at: number; value: EffectiveLicense }>();

/** Call after any Subscription write (webhooks, platform-admin edits) so the next request sees it. */
export function invalidateLicenseCache(orgId?: string) {
  if (orgId) licenseCache.delete(orgId); else licenseCache.clear();
}

export async function getEffectiveLicense(orgId: string): Promise<EffectiveLicense> {
  const hit = licenseCache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const [sub, cfg] = await Promise.all([getOrCreateSubscription(orgId), getPricingConfig()]);
  const value = evaluateLicense(sub as unknown as SubRow, new Date(), cfg);
  licenseCache.set(orgId, { at: Date.now(), value });
  return value;
}

/** Active users whose role counts against the seat limit (everything but EMPLOYEE). */
export async function getBillableSeatCount(orgId: string): Promise<number> {
  return prisma.user.count({
    where: { orgId, isActive: true, role: { not: 'EMPLOYEE' } },
  });
}

/**
 * Throws AppError(402) if adding one more billable-role user (anything
 * other than EMPLOYEE) would exceed the org's plan seat limit. No-op for
 * EMPLOYEE.
 *
 * Only active users count — deactivating someone frees their seat
 * immediately, and downgrading a plan never touches existing users
 * (grandfathered in place); this check only blocks *new* billable seats
 * once the org is at or over its limit.
 */
export async function assertSeatAvailable(orgId: string, role: string): Promise<void> {
  if (!isMeteredRole(role)) return;

  const lic = await getEffectiveLicense(orgId);
  const billableCount = await getBillableSeatCount(orgId);

  if (billableCount >= lic.seats) {
    const lapsedNote = lic.access === 'lapsed' ? ` ${lic.reason} Until payment is restored your organisation is limited to the Free plan's seats.` : '';
    throw new AppError(
      402,
      `Your ${PLANS[lic.effectivePlan].name} plan includes ${lic.seats} seat${lic.seats === 1 ? '' : 's'}. ` +
      `You're already using all ${billableCount} (every role except Employee counts toward this). ` +
      `Upgrade your plan or add seats under Billing to add more people.${lapsedNote}`
    );
  }
}

// ─── Feature gating ──────────────────────────────────────────────────────────
//
// Coarse-grained on purpose — see the FeatureKey comment in utils/stripe.ts.
// A plan value that isn't a known key in PLANS (e.g. a future CUSTOM tier,
// before it has real feature config) fails safe to "no gated features"
// rather than throwing, so an unrecognized plan blocks access to Pro+
// features instead of accidentally granting them.

export async function hasFeature(orgId: string, feature: FeatureKey): Promise<boolean> {
  const lic = await getEffectiveLicense(orgId);
  return lic.features.includes(feature);
}

/** Express middleware factory — 402s with an upgrade message if the org's
 * plan doesn't include `feature`. Mirrors requireRole()'s call shape
 * (middleware/authenticate.ts) so route tables read consistently. */
export function requireFeature(feature: FeatureKey) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      const lic = await getEffectiveLicense(req.user!.orgId);
      if (!lic.features.includes(feature)) {
        const why = lic.access === 'lapsed'
          ? `${lic.reason} Restore payment under Billing to regain access.`
          : `Upgrade your plan or add it to a custom licence under Billing to unlock it.`;
        throw new AppError(402, `This feature isn't included in your ${PLANS[lic.effectivePlan].name} plan. ${why}`);
      }
      next();
    } catch (err) { next(err); }
  };
}

// ─── Hosted storage quota ─────────────────────────────────────────────────
//
// Separate from the seat/feature checks above: this gates the "use our
// hosted storage" option in Settings → Storage (utils/s3Storage.ts), an
// alternative to bring-your-own Google Drive. Same fail-safe-to-0 pattern
// as planFeatures() for an unrecognized plan value.

export async function getStorageQuotaBytes(orgId: string): Promise<number> {
  // A per-org override set by the platform operator in the license editor
  // beats the plan default (evaluateLicense applies it); a CUSTOM licence
  // gets the operator-set customStorageGb when it includes the hosted_storage module.
  const lic = await getEffectiveLicense(orgId);
  return lic.storageQuotaGB * 1024 * 1024 * 1024;
}

/** Sums fileSize across every attachment this org has stored in OUR bucket
 * (provider === 'HOSTED_S3'). Computed on the fly rather than a running
 * counter, so it can never drift out of sync with what's actually stored —
 * a delete always reflects immediately. Google Drive attachments don't
 * count here at all; that storage is the customer's own, not ours. */
// Attachment has no direct orgId column (it's polymorphic — see
// utils/entityAccess.ts) — but every attachment stored under HOSTED_S3 was
// necessarily uploaded by this org (storage.ts only ever uploads to the
// caller's own StorageConfig), so filtering by uploader.orgId is equivalent
// and avoids a join through nine different entity tables.
export async function getHostedStorageUsageBytes(orgId: string): Promise<number> {
  const result = await prisma.attachment.aggregate({
    where: { provider: 'HOSTED_S3', uploader: { orgId } },
    _sum: { fileSize: true },
  });
  return result._sum.fileSize ?? 0;
}

/**
 * Throws AppError(402) before an upload would push the org over its plan's
 * hosted-storage quota (or if the plan doesn't include hosted storage at
 * all, i.e. quota is 0 — FREE orgs must use their own Google Drive).
 * `additionalBytes` is the size of the file about to be uploaded.
 */
export async function assertHostedStorageAvailable(orgId: string, additionalBytes: number): Promise<void> {
  const lic = await getEffectiveLicense(orgId);
  const sub = { plan: PLANS[lic.effectivePlan].name };
  const quotaBytes = lic.storageQuotaGB * 1024 * 1024 * 1024;

  if (quotaBytes === 0) {
    throw new AppError(
      402,
      `Hosted storage isn't included in your ${sub.plan} plan — connect your own Google Drive or your own S3-compatible bucket in Settings → Storage instead, or upgrade to Pro for 5GB of hosted storage.`
    );
  }

  const usedBytes = await getHostedStorageUsageBytes(orgId);
  if (usedBytes + additionalBytes > quotaBytes) {
    const usedGB = (usedBytes / (1024 * 1024 * 1024)).toFixed(2);
    const quotaGB = (quotaBytes / (1024 * 1024 * 1024)).toFixed(0);
    throw new AppError(
      402,
      `This upload would exceed your ${sub.plan} plan's ${quotaGB}GB hosted storage quota (${usedGB}GB used). Delete some files, switch to your own Google Drive, or upgrade your plan.`
    );
  }
}
