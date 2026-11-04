import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { stripe, verifyStripeWebhook, PLANS, PlanKey, isPlanKey } from '../../utils/stripe';
import { getBillableSeatCount, getEffectiveLicense, invalidateLicenseCache } from '../../utils/licensing';
import { getUsageSummary } from '../../utils/usageTracking';
import { computeQuote, normaliseModules, pricingCatalogue, getPricingConfig, BillingInterval, PricingConfig } from '../../utils/pricing';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ─── Ensure subscription row exists ──────────────────────────────────────────

async function getOrCreateSubscription(orgId: string) {
  return prisma.subscription.upsert({
    where: { orgId },
    create: { orgId, plan: 'FREE', status: 'active', seats: 5 },
    update: {},
  });
}

async function ensureStripeCustomer(req: AuthRequest, sub: { stripeCustomerId: string | null }): Promise<string> {
  if (sub.stripeCustomerId) return sub.stripeCustomerId;
  const orgId = req.user!.orgId;
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  const customer = await stripe.customers.create({ email: req.user!.email || '', name: org?.name || '', metadata: { orgId } });
  await prisma.subscription.update({ where: { orgId }, data: { stripeCustomerId: customer.id } });
  return customer.id as string;
}

/** What the Billing page shows as "planConfig" — for CUSTOM the seats/price come from the row. */
function planPrice(plan: PlanKey, cfg: PricingConfig): number {
  return plan === 'PRO' || plan === 'ENTERPRISE' ? cfg.planPrices[plan] : 0;
}

function planView(sub: { plan: string; seats: number; amountCents: number; interval: string; features: string[] }, cfg: PricingConfig) {
  const key: PlanKey = isPlanKey(sub.plan) ? sub.plan : 'FREE';
  const p = PLANS[key];
  const isCustom = key === 'CUSTOM';
  return {
    name: p.name,
    seats: isCustom ? sub.seats : p.seats,
    /** Monthly-equivalent list price in dollars (what the summary card shows) */
    price: isCustom ? Math.round(sub.amountCents / (sub.interval === 'year' ? 12 : 1) / 100) : planPrice(key, cfg),
    priceId: p.priceId,
    features: isCustom ? normaliseModules(sub.features) : [...p.features],
    storageQuotaGB: isCustom ? (sub.features.includes('hosted_storage') ? cfg.customStorageGb : 0) : p.storageQuotaGB,
  };
}

// ─── GET /api/billing/pricing ────────────────────────────────────────────────
export async function getPricing(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cfg = await getPricingConfig();
    res.json({
      ...pricingCatalogue(cfg),
      plans: (['FREE', 'PRO', 'ENTERPRISE'] as const).map(k => ({
        key: k, name: PLANS[k].name, price: planPrice(k, cfg), seats: PLANS[k].seats,
        features: PLANS[k].features, storageQuotaGB: PLANS[k].storageQuotaGB, stripeConfigured: !!PLANS[k].priceId,
      })),
    });
  } catch (err) { next(err); }
}

// ─── GET /api/billing/entitlements  (any signed-in user) ─────────────────────
export async function getEntitlements(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [lic, cfg] = await Promise.all([getEffectiveLicense(req.user!.orgId), getPricingConfig()]);
    res.json({ ...lic, gracePeriodDays: cfg.gracePeriodDays });
  } catch (err) { next(err); }
}

// ─── GET /api/billing/subscription ───────────────────────────────────────────
export async function getSubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const sub = await getOrCreateSubscription(orgId);
    // seatsUsed counts every active user except EMPLOYEE (see utils/licensing.ts)
    // — mirrors exactly what assertSeatAvailable() checks, so the billing page
    // never shows a number that disagrees with what actually gets blocked.
    const [seatsUsed, usage, license, cfg] = await Promise.all([
      getBillableSeatCount(orgId),
      // No plan reads this yet (no included quotas exist) — purely so orgs
      // (and we) can see real AI/WhatsApp usage before any limit is set.
      getUsageSummary(orgId),
      getEffectiveLicense(orgId),
      getPricingConfig(),
    ]);
    res.json({ ...sub, seatsUsed, usage, license, planConfig: planView(sub, cfg) });
  } catch (err) { next(err); }
}

// ─── POST /api/billing/quote — price a custom licence, no side effects ───────
const QuoteSchema = z.object({
  seats: z.number().int().min(1).max(100_000),
  modules: z.array(z.string()).default([]),
  interval: z.enum(['month', 'year']).default('month'),
});

/** Parse + validate against the live pricing config (seat bounds, purchasable modules). */
async function parseQuoteInput(body: unknown) {
  const input = QuoteSchema.parse(body);
  const cfg = await getPricingConfig();
  if (input.seats < cfg.minSeats || input.seats > cfg.maxSeats) {
    throw new AppError(400, `Seats must be between ${cfg.minSeats} and ${cfg.maxSeats}.`);
  }
  const disabled = normaliseModules(input.modules).filter(k => !cfg.modules.find(m => m.key === k)?.enabled);
  if (disabled.length) throw new AppError(400, `These modules are not currently available: ${disabled.join(', ')}.`);
  return { input, cfg };
}

export async function quoteCustom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { input, cfg } = await parseQuoteInput(req.body);
    res.json(computeQuote(input, cfg));
  } catch (err) { next(err); }
}

// ─── POST /api/billing/checkout — fixed plan (PRO / ENTERPRISE) ──────────────
// Flat plan price (PLANS.price). A configured Stripe Price is used for monthly
// billing; yearly (or no Price configured) is priced dynamically so the annual
// discount needs no extra Stripe dashboard setup.
const CheckoutSchema = z.object({
  plan: z.enum(['PRO', 'ENTERPRISE']),
  interval: z.enum(['month', 'year']).default('month'),
});

export async function createCheckout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { plan, interval } = CheckoutSchema.parse(req.body);
    const def = PLANS[plan];
    const orgId = req.user!.orgId;
    const [sub, cfg] = await Promise.all([getOrCreateSubscription(orgId), getPricingConfig()]);
    const customer = await ensureStripeCustomer(req, sub);

    const monthlyCents = Math.round(planPrice(plan, cfg) * 100);
    const unitAmount = Math.round(interval === 'year' ? monthlyCents * cfg.yearlyMonthsCharged : monthlyCents);
    const lineItem = def.priceId && interval === 'month'
      ? { price: def.priceId, quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: 'usd', unit_amount: unitAmount, recurring: { interval },
            product_data: { name: `CRMITdesk ${def.name}`, description: `${def.name} plan · ${def.seats} billable seats · billed ${interval === 'year' ? 'yearly' : 'monthly'}`, metadata: { plan } },
          },
        };

    const metadata = { orgId, plan, seats: String(def.seats), interval, features: def.features.join(','), amountCents: String(unitAmount) };
    const session = await stripe.checkout.sessions.create({
      customer,
      mode: 'subscription',
      success_url: `${FRONTEND_URL}/billing?success=1`,
      cancel_url: `${FRONTEND_URL}/billing?canceled=1`,
      line_items: [lineItem],
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
    });

    res.json({ url: (session as any).url });
  } catch (err) { next(err); }
}

// ─── POST /api/billing/custom-checkout — build-your-own licence ──────────────
// Per-seat: Stripe quantity = seats, unit_amount = discounted per-seat price
// per interval (see computeQuote). Modules/seats/interval ride along in
// metadata so the webhook can write them onto the Subscription row.
export async function createCustomCheckout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { input, cfg } = await parseQuoteInput(req.body);
    const quote = computeQuote(input, cfg);
    if (quote.modules.length === 0) throw new AppError(400, 'Select at least one module for a custom licence.');

    const orgId = req.user!.orgId;
    const sub = await getOrCreateSubscription(orgId);
    const customer = await ensureStripeCustomer(req, sub);

    const moduleNames = quote.modules.map(k => cfg.modules.find(m => m.key === k)?.name ?? k).join(', ');
    const metadata = {
      orgId, plan: 'CUSTOM', seats: String(quote.seats), interval: quote.interval,
      features: quote.modules.join(','), amountCents: String(quote.totalPerIntervalCents),
    };

    const session = await stripe.checkout.sessions.create({
      customer,
      mode: 'subscription',
      success_url: `${FRONTEND_URL}/billing?success=1`,
      cancel_url: `${FRONTEND_URL}/billing/custom?canceled=1`,
      line_items: [{
        quantity: quote.seats,
        price_data: {
          currency: 'usd',
          unit_amount: quote.unitAmountPerIntervalCents,
          recurring: { interval: quote.interval },
          product_data: {
            name: `CRMITdesk Custom Licence — per seat, ${quote.interval === 'year' ? 'yearly' : 'monthly'}`,
            description: `Modules: ${moduleNames}${quote.volumeDiscountPct ? ` · ${quote.volumeDiscountPct}% volume discount` : ''}`,
            metadata: { features: quote.modules.join(',') },
          },
        },
      }],
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
    });

    res.json({ url: (session as any).url, quote });
  } catch (err) { next(err); }
}

// ─── POST /api/billing/portal ────────────────────────────────────────────────
export async function createPortal(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sub = await prisma.subscription.findUnique({ where: { orgId: req.user!.orgId } });
    if (!sub?.stripeCustomerId) throw new AppError(400, 'No active Stripe subscription');

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${FRONTEND_URL}/billing`,
    });

    res.json({ url: (session as any).url });
  } catch (err) { next(err); }
}

// ─── POST /api/billing/webhook  (public — raw body, Stripe signature) ────────

/** Licence fields we stash in Checkout/Subscription metadata. */
function parseLicenceMetadata(md: Record<string, string> | null | undefined) {
  if (!md?.plan || !isPlanKey(md.plan) || md.plan === 'FREE') return null;
  const plan = md.plan;
  const seats = Math.max(1, parseInt(md.seats || '', 10) || PLANS[plan].seats || 5);
  const interval: BillingInterval = md.interval === 'year' ? 'year' : 'month';
  const features = plan === 'CUSTOM' ? normaliseModules((md.features || '').split(',')) : [];
  const amountCents = parseInt(md.amountCents || '0', 10) || 0;
  return { plan, seats, interval, features, amountCents };
}

const FREE_RESET = {
  plan: 'FREE', status: 'active', stripeSubscriptionId: null, seats: PLANS.FREE.seats, features: [] as string[],
  interval: 'month', amountCents: 0, cancelAtPeriodEnd: false, currentPeriodEnd: null, graceUntil: null, lastPaymentFailedAt: null,
};

export async function handleWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const sig = req.headers['stripe-signature'] as string;
    let event: any;
    try {
      event = verifyStripeWebhook(req.body as Buffer, sig);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const data = event.data.object;
    let touchedOrgId: string | undefined;

    switch (event.type) {
      case 'checkout.session.completed': {
        const orgId = data.metadata?.orgId;
        const lic = parseLicenceMetadata(data.metadata);
        if (!orgId || !lic) break;
        touchedOrgId = orgId;
        const fields = {
          stripeCustomerId: data.customer, stripeSubscriptionId: data.subscription, ...lic,
          status: 'active', cancelAtPeriodEnd: false, graceUntil: null, lastPaymentFailedAt: null,
        };
        await prisma.subscription.upsert({ where: { orgId }, create: { orgId, ...fields }, update: fields });
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: data.id } });
        if (!sub) break;
        touchedOrgId = sub.orgId;
        const item = data.items?.data?.[0];
        const lic = parseLicenceMetadata(data.metadata);
        const qty: number | undefined = item?.quantity;
        const unit: number | undefined = item?.price?.unit_amount;
        const recurring: string | undefined = item?.price?.recurring?.interval;
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: data.status,
            cancelAtPeriodEnd: !!data.cancel_at_period_end,
            currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end * 1000) : sub.currentPeriodEnd,
            ...(lic ? { plan: lic.plan, features: lic.features, ...(lic.plan !== 'CUSTOM' ? { seats: lic.seats } : {}) } : {}),
            // Seat changes made in the Stripe portal on a per-seat (CUSTOM) subscription
            ...((lic?.plan ?? sub.plan) === 'CUSTOM' && qty ? { seats: qty } : {}),
            ...(recurring === 'month' || recurring === 'year' ? { interval: recurring } : {}),
            ...(unit && qty ? { amountCents: unit * qty } : {}),
            ...(data.status === 'active' || data.status === 'trialing' ? { graceUntil: null, lastPaymentFailedAt: null } : {}),
          },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: data.id } });
        if (!sub) break;
        touchedOrgId = sub.orgId;
        await prisma.subscription.update({ where: { id: sub.id }, data: FREE_RESET });
        break;
      }

      case 'invoice.payment_failed': {
        const sub = data.subscription ? await prisma.subscription.findFirst({ where: { stripeSubscriptionId: data.subscription } }) : null;
        if (!sub) break;
        touchedOrgId = sub.orgId;
        const now = new Date();
        const cfg = await getPricingConfig();
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'past_due',
            lastPaymentFailedAt: now,
            // Keep an already-running grace deadline; Stripe retries several times
            graceUntil: sub.graceUntil ?? new Date(now.getTime() + cfg.gracePeriodDays * 86_400_000),
          },
        });
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const sub = data.subscription ? await prisma.subscription.findFirst({ where: { stripeSubscriptionId: data.subscription } }) : null;
        if (!sub) break;
        touchedOrgId = sub.orgId;
        const periodEnd: number | undefined = data.lines?.data?.[0]?.period?.end;
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'active',
            graceUntil: null,
            lastPaymentFailedAt: null,
            ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
            ...(typeof data.amount_paid === 'number' && data.amount_paid > 0 ? { amountCents: data.amount_paid } : {}),
          },
        });
        break;
      }
    }

    if (touchedOrgId) invalidateLicenseCache(touchedOrgId);
    res.json({ received: true });
  } catch (err) { next(err); }
}
