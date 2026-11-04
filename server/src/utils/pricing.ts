// ─── Licence pricing ─────────────────────────────────────────────────────────
//
// WHO SETS PRICES: the platform operator (PLATFORM_ADMIN), from Platform Admin
// → Pricing. Values are stored as JSON on the PlatformSettings singleton and
// layered over the code/env defaults below, so a blank field keeps the default.
// A customer org's SUPER_ADMIN can only *buy* at these prices — never set them.
//
// Fixed plans (FREE / PRO / ENTERPRISE) keep their seat allowances and feature
// lists in utils/stripe.ts PLANS; their monthly list price is editable here.
// The CUSTOM licence is priced per seat: base + an add-on per enabled module,
// with a volume discount on seat count and a yearly discount (12 months for
// the price of yearlyMonthsCharged). All amounts are USD cents unless the
// field name says otherwise.

import { prisma } from './prisma';
import { FeatureKey } from './stripe';

export type BillingInterval = 'month' | 'year';
export type ModuleKey = FeatureKey | 'hosted_storage';

export interface ModuleDef {
  key: ModuleKey;
  name: string;
  description: string;
  /** Add-on per seat per month, in cents */
  pricePerSeatCents: number;
  /** Disabled modules can't be added to a new custom licence (existing licences keep them) */
  enabled: boolean;
}

export interface PricingConfig {
  /** Platform base per seat per month for custom licences */
  baseSeatPriceCents: number;
  /** Monthly list price (dollars) of the fixed plans — used for dynamic Stripe pricing and the Billing page */
  planPrices: { PRO: number; ENTERPRISE: number };
  /** Hosted storage granted to a custom licence that includes hosted_storage */
  customStorageGb: number;
  /** Yearly = 12 months for the price of N */
  yearlyMonthsCharged: number;
  /** Continued paid access after a failed payment, in days */
  gracePeriodDays: number;
  minSeats: number;
  maxSeats: number;
  /** First matching tier (highest minSeats first) wins */
  volumeTiers: { minSeats: number; discountPct: number }[];
  modules: ModuleDef[];
}

/** Every module that can be switched on in a custom licence. Each key maps to an
 *  existing gate: FeatureKeys → requireFeature(); hosted_storage → the hosted
 *  attachment quota (assertHostedStorageAvailable). */
export const DEFAULT_MODULES: ModuleDef[] = [
  { key: 'ai_advanced',         name: 'Advanced AI',          description: 'AI Studio, NL command bar, insights, drafting, custom AI rules & scripts', pricePerSeatCents: 1000, enabled: true },
  { key: 'workflow_automation', name: 'Workflow Automation',  description: 'Create rule-based automations and triggers', pricePerSeatCents: 400, enabled: true },
  { key: 'customer_portal',     name: 'Customer Portal',      description: 'Self-service portal accounts for your customers', pricePerSeatCents: 400, enabled: true },
  { key: 'advanced_analytics',  name: 'Advanced Analytics',   description: 'Analytics dashboards and ticket / CRM reports', pricePerSeatCents: 400, enabled: true },
  { key: 'custom_branding',     name: 'Custom Branding',      description: 'Your logo and colours on the customer portal', pricePerSeatCents: 300, enabled: true },
  { key: 'hosted_storage',      name: 'Hosted Storage',       description: 'Hosted attachment storage (no Google Drive needed)', pricePerSeatCents: 200, enabled: true },
];

export const MODULE_KEYS: string[] = DEFAULT_MODULES.map(m => m.key);

export const DEFAULT_PRICING: PricingConfig = {
  baseSeatPriceCents: Number(process.env.LICENSE_BASE_SEAT_PRICE_CENTS || 800),
  planPrices: { PRO: 49, ENTERPRISE: 149 },
  customStorageGb: Number(process.env.LICENSE_CUSTOM_STORAGE_GB || 10),
  yearlyMonthsCharged: Number(process.env.LICENSE_YEARLY_MONTHS_CHARGED || 10),
  gracePeriodDays: Number(process.env.LICENSE_GRACE_PERIOD_DAYS || 7),
  minSeats: 1,
  maxSeats: 1000,
  volumeTiers: [
    { minSeats: 201, discountPct: 20 },
    { minSeats: 51,  discountPct: 10 },
  ],
  modules: DEFAULT_MODULES,
};

// ─── Stored overrides ────────────────────────────────────────────────────────

/** Shape accepted from Platform Admin → Pricing (every field optional; modules merged by key). */
export type ModuleOverride = { key: string } & Partial<Pick<ModuleDef, 'name' | 'description' | 'pricePerSeatCents' | 'enabled'>>;
export type PricingOverride = Partial<Omit<PricingConfig, 'modules' | 'planPrices'>> & {
  planPrices?: Partial<PricingConfig['planPrices']>;
  modules?: ModuleOverride[];
};

const num = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Layer a stored override over the defaults, sanitising every number. */
export function mergePricing(override: PricingOverride | null | undefined): PricingConfig {
  const o = override ?? {};
  const d = DEFAULT_PRICING;
  const modules = DEFAULT_MODULES.map(m => {
    const ov = Array.isArray(o.modules) ? o.modules.find(x => x && x.key === m.key) : undefined;
    return {
      ...m,
      name: typeof ov?.name === 'string' && ov.name.trim() ? ov.name.trim() : m.name,
      description: typeof ov?.description === 'string' ? ov.description : m.description,
      pricePerSeatCents: Math.round(num(ov?.pricePerSeatCents, m.pricePerSeatCents, 0, 1_000_000)),
      enabled: typeof ov?.enabled === 'boolean' ? ov.enabled : m.enabled,
    };
  });
  const tiers = (Array.isArray(o.volumeTiers) ? o.volumeTiers : d.volumeTiers)
    .filter(t => t && typeof t === 'object')
    .map(t => ({ minSeats: Math.round(num(t.minSeats, 1, 1, 100_000)), discountPct: num(t.discountPct, 0, 0, 90) }))
    .filter(t => t.discountPct > 0)
    .sort((a, b) => b.minSeats - a.minSeats);
  const minSeats = Math.round(num(o.minSeats, d.minSeats, 1, 100_000));
  return {
    baseSeatPriceCents: Math.round(num(o.baseSeatPriceCents, d.baseSeatPriceCents, 0, 1_000_000)),
    planPrices: {
      PRO: num(o.planPrices?.PRO, d.planPrices.PRO, 0, 1_000_000),
      ENTERPRISE: num(o.planPrices?.ENTERPRISE, d.planPrices.ENTERPRISE, 0, 1_000_000),
    },
    customStorageGb: Math.round(num(o.customStorageGb, d.customStorageGb, 0, 100_000)),
    yearlyMonthsCharged: num(o.yearlyMonthsCharged, d.yearlyMonthsCharged, 1, 12),
    gracePeriodDays: Math.round(num(o.gracePeriodDays, d.gracePeriodDays, 0, 365)),
    minSeats,
    maxSeats: Math.max(minSeats, Math.round(num(o.maxSeats, d.maxSeats, 1, 100_000))),
    volumeTiers: tiers,
    modules,
  };
}

const CACHE_TTL_MS = 30_000;
let cached: { at: number; value: PricingConfig } | null = null;

export function invalidatePricingCache() { cached = null; }

/** Effective pricing = stored operator overrides over defaults. Cached briefly. */
export async function getPricingConfig(): Promise<PricingConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const row = await prisma.platformSettings.findUnique({ where: { id: 'platform' }, select: { pricing: true } }).catch(() => null);
  const value = mergePricing((row?.pricing ?? null) as PricingOverride | null);
  cached = { at: Date.now(), value };
  return value;
}

/** Persist an operator override (stored as-is; merged on read). */
export async function savePricingOverride(override: PricingOverride): Promise<PricingConfig> {
  await prisma.platformSettings.upsert({
    where: { id: 'platform' },
    create: { id: 'platform', pricing: override as object },
    update: { pricing: override as object },
  });
  invalidatePricingCache();
  return mergePricing(override);
}

// ─── Quote calculation ───────────────────────────────────────────────────────

export interface QuoteInput { seats: number; modules: string[]; interval: BillingInterval }
export interface QuoteLine { key: string; name: string; pricePerSeatCents: number; monthlyCents: number }

export interface Quote {
  seats: number;
  interval: BillingInterval;
  modules: string[];
  currency: 'usd';
  lines: QuoteLine[];
  perSeatMonthlyCents: number;
  subtotalMonthlyCents: number;
  volumeDiscountPct: number;
  volumeDiscountMonthlyCents: number;
  totalMonthlyCents: number;
  monthsCharged: number;
  /** Saving per interval vs paying monthly (yearly only) */
  intervalSavingCents: number;
  /** What Stripe bills per interval = unitAmountPerIntervalCents × seats */
  totalPerIntervalCents: number;
  unitAmountPerIntervalCents: number;
}

/** Dedupe, drop unknown keys, keep canonical order. Does NOT drop disabled modules —
 *  an org that already licensed one keeps it; purchasability is checked at checkout. */
export function normaliseModules(modules: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(modules)) for (const m of modules) if (typeof m === 'string' && MODULE_KEYS.includes(m)) set.add(m);
  return MODULE_KEYS.filter(k => set.has(k));
}

export function volumeDiscountFor(seats: number, cfg: PricingConfig): number {
  return cfg.volumeTiers.find(t => seats >= t.minSeats)?.discountPct ?? 0;
}

export function computeQuote(input: QuoteInput, cfg: PricingConfig): Quote {
  const seats = Math.min(cfg.maxSeats, Math.max(cfg.minSeats, Math.floor(Number(input.seats) || cfg.minSeats)));
  const interval: BillingInterval = input.interval === 'year' ? 'year' : 'month';
  const modules = normaliseModules(input.modules);

  const lines: QuoteLine[] = [
    { key: 'base', name: 'Platform base (CRM + IT Desk)', pricePerSeatCents: cfg.baseSeatPriceCents, monthlyCents: cfg.baseSeatPriceCents * seats },
    ...modules.map(k => cfg.modules.find(m => m.key === k)!).map(m => ({ key: m.key, name: m.name, pricePerSeatCents: m.pricePerSeatCents, monthlyCents: m.pricePerSeatCents * seats })),
  ];

  const perSeatMonthlyCents = lines.reduce((s, l) => s + l.pricePerSeatCents, 0);
  const subtotalMonthlyCents = perSeatMonthlyCents * seats;
  const volumeDiscountPct = volumeDiscountFor(seats, cfg);
  const discountedPerSeatMonthly = Math.round(perSeatMonthlyCents * (100 - volumeDiscountPct) / 100);
  const totalMonthlyCents = discountedPerSeatMonthly * seats;
  const volumeDiscountMonthlyCents = subtotalMonthlyCents - totalMonthlyCents;

  const monthsCharged = interval === 'year' ? cfg.yearlyMonthsCharged : 1;
  const unitAmountPerIntervalCents = Math.round(discountedPerSeatMonthly * monthsCharged);
  const totalPerIntervalCents = unitAmountPerIntervalCents * seats;
  const intervalSavingCents = interval === 'year' ? Math.round(totalMonthlyCents * 12 - totalPerIntervalCents) : 0;

  return {
    seats, interval, modules, currency: 'usd', lines,
    perSeatMonthlyCents, subtotalMonthlyCents, volumeDiscountPct, volumeDiscountMonthlyCents,
    totalMonthlyCents, monthsCharged, intervalSavingCents, totalPerIntervalCents, unitAmountPerIntervalCents,
  };
}

/** Client-safe catalogue for the licence builder — only purchasable modules. */
export function pricingCatalogue(cfg: PricingConfig) {
  return {
    currency: 'usd',
    baseSeatPriceCents: cfg.baseSeatPriceCents,
    minSeats: cfg.minSeats,
    maxSeats: cfg.maxSeats,
    yearlyMonthsCharged: cfg.yearlyMonthsCharged,
    volumeTiers: cfg.volumeTiers,
    gracePeriodDays: cfg.gracePeriodDays,
    customStorageGb: cfg.customStorageGb,
    planPrices: cfg.planPrices,
    modules: cfg.modules.filter(m => m.enabled),
  };
}
