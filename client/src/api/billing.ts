import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from './client';

export type PlanKey = 'FREE' | 'PRO' | 'ENTERPRISE' | 'CUSTOM';
export type BillingInterval = 'month' | 'year';

export interface ModuleDef {
  key: string;
  name: string;
  description: string;
  pricePerSeatCents: number;
}

export interface PricingCatalogue {
  currency: string;
  baseSeatPriceCents: number;
  minSeats: number;
  maxSeats: number;
  yearlyMonthsCharged: number;
  volumeTiers: { minSeats: number; discountPct: number }[];
  gracePeriodDays: number;
  customStorageGb: number;
  modules: ModuleDef[];
  plans: { key: 'FREE' | 'PRO' | 'ENTERPRISE'; name: string; price: number; seats: number; features: string[]; storageQuotaGB: number; stripeConfigured: boolean }[];
}

/** GET /billing/entitlements — the org's effective licence after payment state is applied. */
export interface License {
  orgId: string;
  plan: PlanKey;
  effectivePlan: PlanKey;
  status: string;
  seats: number;
  features: string[];
  storageQuotaGB: number;
  interval: string;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  cancelAtPeriodEnd: boolean;
  access: 'full' | 'grace' | 'lapsed';
  reason: string | null;
  gracePeriodDays?: number;
}

export interface Subscription {
  id: string;
  orgId: string;
  plan: PlanKey;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  seats: number;
  seatsUsed: number;
  interval: BillingInterval;
  features: string[];
  amountCents: number;
  graceUntil: string | null;
  lastPaymentFailedAt: string | null;
  usage: { aiCalls: number; whatsappSends: number; periodStart: string; periodEnd: string };
  createdAt: string;
  license: License;
  planConfig: { name: string; seats: number; price: number; priceId: string | null; features: string[]; storageQuotaGB: number };
}

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
  intervalSavingCents: number;
  totalPerIntervalCents: number;
  unitAmountPerIntervalCents: number;
}

export interface QuoteInput { seats: number; modules: string[]; interval: BillingInterval }

export const fmtUsd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

/** GET /billing/subscription is SUPER_ADMIN-only — callers pass `can.readBilling(role)`. */
export function useSubscription(enabled = true) {
  return useQuery<Subscription>({
    queryKey: ['subscription'],
    queryFn: () => api.get('/billing/subscription').then(r => r.data),
    enabled,
  });
}

export function usePricing(enabled = true) {
  return useQuery<PricingCatalogue>({
    queryKey: ['billing-pricing'],
    queryFn: () => api.get('/billing/pricing').then(r => r.data),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/** Any signed-in user — drives the payment-state banner. */
export function useLicense(enabled = true) {
  return useQuery<License>({
    queryKey: ['license'],
    queryFn: () => api.get('/billing/entitlements').then(r => r.data),
    staleTime: 60 * 1000,
    enabled,
  });
}

export function useQuote(input: QuoteInput, enabled = true) {
  return useQuery<Quote>({
    queryKey: ['billing-quote', input.seats, input.interval, [...input.modules].sort().join(',')],
    queryFn: () => api.post('/billing/quote', input).then(r => r.data),
    enabled,
    placeholderData: prev => prev,
  });
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: (body: { plan: 'PRO' | 'ENTERPRISE'; interval?: BillingInterval }) =>
      api.post('/billing/checkout', body).then(r => r.data),
    onSuccess: (data: { url: string }) => { window.location.href = data.url; },
  });
}

export function useCreateCustomCheckout() {
  return useMutation({
    mutationFn: (body: QuoteInput) => api.post('/billing/custom-checkout', body).then(r => r.data),
    onSuccess: (data: { url: string }) => { window.location.href = data.url; },
  });
}

export function useCreatePortal() {
  return useMutation({
    mutationFn: () => api.post('/billing/portal').then(r => r.data),
    onSuccess: (data: { url: string }) => { window.location.href = data.url; },
  });
}
