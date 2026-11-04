import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard, CheckCircle, Zap, Building2, Star, ExternalLink, Sparkles, AlertTriangle } from 'lucide-react';
import { useSubscription, useCreateCheckout, useCreatePortal, usePricing, fmtUsd, BillingInterval } from '../api/billing';
import {
  PageHeader, PageBody, Card, StatTile, SectionHeader, Button, Badge, Alert, SkeletonCard, AccessDenied,
} from '../shared/components';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

const PLAN_ICONS = { FREE: Star, PRO: Zap, ENTERPRISE: Building2, CUSTOM: Sparkles };

/** Icon tint per plan — accent marks "us / recommended", never a loose hue. */
const PLAN_ICON_TINT = {
  FREE: 'text-fg-subtle',
  PRO: 'text-accent',
  ENTERPRISE: 'text-info',
  CUSTOM: 'text-warning',
} as const;

const PLAN_BADGE = { FREE: 'gray', PRO: 'purple', ENTERPRISE: 'blue', CUSTOM: 'yellow' } as const;
const PLAN_NAMES = { FREE: 'Free', PRO: 'Pro', ENTERPRISE: 'Enterprise', CUSTOM: 'Custom' } as const;

/** Labels for licensed feature keys (server utils/pricing.ts MODULES + hosted storage). */
const FEATURE_LABELS: Record<string, string> = {
  ai_advanced: 'Advanced AI', workflow_automation: 'Workflow automation', customer_portal: 'Customer portal',
  advanced_analytics: 'Advanced analytics', custom_branding: 'Custom branding', hosted_storage: 'Hosted storage',
};

const FEATURES: Record<string, string[]> = {
  FREE:       ['5 billable seats (Employees are unlimited)', 'CRM + IT Desk', 'Email notifications', 'AI features (limited)', 'Attachments via your own Google Drive', 'Community support'],
  PRO:        ['25 billable seats (Employees are unlimited)', 'Everything in Free', 'Unlimited inbox messages', 'Workflow automation', 'Customer portal', 'Advanced analytics', '5GB hosted attachment storage (or keep using your own Drive)', 'Priority support'],
  ENTERPRISE: ['Unlimited billable seats', 'Everything in Pro', 'SSO / SAML', 'Custom branding', '50GB hosted attachment storage', 'SLA guarantees', 'Dedicated account manager'],
  CUSTOM:     ['Pick exactly the modules you need', 'Any number of billable seats, priced per seat', 'Volume discounts from 51 seats', 'Monthly or yearly billing', 'Optional hosted attachment storage'],
};

export function BillingPage() {
  const { date, timezone } = useFormat();
  const monthDay = (v: string) => new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(v));
  const [searchParams] = useSearchParams();
  /* GET /billing/subscription is SUPER_ADMIN-only, and so are checkout and the
     billing portal — there is nothing on this page anyone else can use, and
     without the subscription every plan card silently claimed "Free" was the
     current plan. Refuse the page rather than mislead. */
  const { user } = useAuth();
  const canReadBilling = can.readBilling(user?.role);
  const { data: sub, isLoading } = useSubscription(canReadBilling);
  const { data: pricing } = usePricing(canReadBilling);
  const checkout = useCreateCheckout();
  const portal = useCreatePortal();
  const [interval, setInterval] = useState<BillingInterval>('month');

  const success = searchParams.get('success') === '1';
  const canceled = searchParams.get('canceled') === '1';

  if (!canReadBilling) return <AccessDenied />;

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Billing & Plans" subtitle="Manage your subscription and billing details." />
        <PageBody>
          <SkeletonCard lines={4} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-hidden="true">
            <SkeletonCard lines={6} />
            <SkeletonCard lines={6} />
            <SkeletonCard lines={6} />
          </div>
        </PageBody>
      </div>
    );
  }

  const current = sub?.plan || 'FREE';
  const lic = sub?.license;
  const monthsCharged = pricing?.yearlyMonthsCharged ?? 10;
  const yearlySavePct = Math.round((12 - monthsCharged) / 12 * 100);
  const licensedFeatures = lic?.features ?? sub?.planConfig.features ?? [];
  const storageGb = lic?.storageQuotaGB ?? sub?.planConfig.storageQuotaGB ?? 0;
  const statusVariant = sub?.status === 'active' || sub?.status === 'trialing' ? 'green' : sub?.status === 'past_due' ? 'yellow' : 'red';

  return (
    <div>
      <PageHeader
        title="Billing & Plans"
        subtitle="Manage your subscription and billing details."
        actions={sub?.stripeCustomerId ? (
          <Button
            variant="secondary"
            icon={<ExternalLink size={14} />}
            loading={portal.isPending}
            onClick={() => portal.mutate()}
          >
            Manage billing
          </Button>
        ) : undefined}
      />

      <PageBody>
        {/* Flash messages */}
        {success && (
          <Alert tone="success" icon={<CheckCircle size={18} />}>
            Subscription updated successfully! Your plan is now active.
          </Alert>
        )}
        {canceled && (
          <Alert tone="warning">
            Checkout was cancelled. Your current plan is unchanged.
          </Alert>
        )}

        {/* Payment state — the server already applies this to what the org can do */}
        {lic?.access === 'grace' && (
          <div data-testid="licence-grace-banner">
            <Alert tone="warning" icon={<AlertTriangle size={16} />} title="Payment problem — grace period active">
              {lic.reason} Use "Manage billing" to update your payment method.
            </Alert>
          </div>
        )}
        {lic?.access === 'lapsed' && (
          <div data-testid="licence-lapsed-banner">
            <Alert tone="danger" icon={<AlertTriangle size={16} />} title="Your paid licence has lapsed">
              {lic.reason} Until payment is restored your organisation has Free-plan limits: existing users, rules and files keep working, but paid features and extra seats are locked. Use "Manage billing" or choose a plan below.
            </Alert>
          </div>
        )}

        {/* Current plan summary */}
        {sub && (
          <Card>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">Current plan</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[17px] font-semibold text-fg tracking-tight">{sub.planConfig.name}</span>
                  <Badge variant={statusVariant} dot>{sub.status.replace(/_/g, ' ')}</Badge>
                  {sub.cancelAtPeriodEnd && <Badge variant="yellow">Cancels at period end</Badge>}
                  {sub.interval === 'year' && <Badge variant="gray">Yearly</Badge>}
                </div>
                <p className="text-[13px] text-fg-muted mt-1 tabular-nums">
                  {sub.seats} seats · {sub.plan === 'CUSTOM'
                    ? `${fmtUsd(sub.amountCents)}/${sub.interval === 'year' ? 'year' : 'month'} (${fmtUsd(Math.round(sub.amountCents / (sub.interval === 'year' ? 12 : 1) / Math.max(1, sub.seats)))}/seat/month)`
                    : sub.planConfig.price > 0 ? `$${sub.planConfig.price}/mo` : 'Free forever'}
                </p>
              </div>
              <div className="text-right">
                {sub.currentPeriodEnd && (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{sub.cancelAtPeriodEnd ? 'Access until' : 'Next billing date'}</p>
                    <p className="text-[13px] font-medium text-fg mt-0.5 tabular-nums">{date(sub.currentPeriodEnd)}</p>
                  </>
                )}
                {sub.plan === 'CUSTOM' && (
                  <Link to="/billing/custom" className="inline-block mt-2 text-[12.5px] font-medium text-accent hover:underline">Change modules or seats →</Link>
                )}
              </div>
            </div>

            {/* Licensed modules */}
            <div className="mt-4 pt-4 border-t border-line-subtle">
              <p className="text-[11.5px] font-medium text-fg-muted mb-1.5">Licensed modules</p>
              <div className="flex flex-wrap gap-1.5" data-testid="licensed-modules">
                <Badge variant="green">CRM + IT Desk core</Badge>
                {licensedFeatures.map(k => <Badge key={k} variant="gray">{FEATURE_LABELS[k] ?? k}</Badge>)}
                {storageGb > 0 && <Badge variant="gray">{storageGb}GB hosted storage</Badge>}
                {lic?.access === 'lapsed' && <Badge variant="red">Limited to Free until payment is restored</Badge>}
              </div>
            </div>

            {/* Seat usage */}
            <div className="mt-4 pt-4 border-t border-line-subtle">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11.5px] font-medium text-fg-muted">Billable seats used</p>
                <p className={`text-[11.5px] font-semibold tabular-nums ${sub.seatsUsed >= sub.seats ? 'text-danger' : 'text-fg'}`}>
                  {sub.seatsUsed} / {sub.seats}
                </p>
              </div>
              <div className="w-full h-2 bg-surface-sunken rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${sub.seatsUsed >= sub.seats ? 'bg-danger' : sub.seatsUsed / sub.seats >= 0.8 ? 'bg-warning' : 'bg-accent'}`}
                  style={{ width: `${Math.min(100, (sub.seatsUsed / sub.seats) * 100)}%` }}
                />
              </div>
              <p className="text-[11.5px] text-fg-subtle mt-1.5">
                Every role counts except Employee — those logins are free and unlimited.
                {sub.seatsUsed >= sub.seats && ' You\'re at your limit; upgrade to add more people in a billable role.'}
              </p>
            </div>
          </Card>
        )}

        {/* Usage this month — informational only, nothing here is billed or
            capped yet. Purely visibility until real limits get set. */}
        {sub && (
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-3">
              Usage this month <span className="font-normal normal-case tracking-normal text-fg-subtle">({monthDay(sub.usage.periodStart)} – {monthDay(sub.usage.periodEnd)})</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatTile tone="sunken" label="AI calls" value={sub.usage.aiCalls.toLocaleString()} />
              <StatTile tone="sunken" label="WhatsApp messages sent" value={sub.usage.whatsappSends.toLocaleString()} />
            </div>
            <p className="text-[11.5px] text-fg-subtle mt-3">Not currently limited or billed separately — shown for visibility only.</p>
          </Card>
        )}

        {/* Plan cards */}
        <SectionHeader
          title="Available Plans"
          actions={
            <div role="radiogroup" aria-label="Billing cycle" className="inline-flex rounded-lg border border-line p-0.5 bg-surface-sunken">
              {(['month', 'year'] as const).map(i => (
                <button
                  key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => setInterval(i)}
                  className={`px-3 py-1 rounded-md text-[12px] font-medium transition ${interval === i ? 'bg-surface shadow-ui-sm text-fg' : 'text-fg-muted hover:text-fg'}`}
                >
                  {i === 'month' ? 'Monthly' : `Yearly · save ${yearlySavePct}%`}
                </button>
              ))}
            </div>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {(['FREE', 'PRO', 'ENTERPRISE', 'CUSTOM'] as const).map(plan => {
            const isCurrent = plan === current;
            const Icon = PLAN_ICONS[plan];
            const monthly = plan === 'PRO' || plan === 'ENTERPRISE' ? (pricing?.plans.find(p => p.key === plan)?.price ?? (plan === 'PRO' ? 49 : 149)) : 0;
            const price = interval === 'year' ? Math.round(monthly * monthsCharged / 12) : monthly;
            const locked = isCurrent || plan === 'FREE';

            return (
              <Card
                key={plan}
                data-testid={`plan-card-${plan}`}
                padding="lg"
                className={`relative flex flex-col card-hover ${
                  isCurrent ? '!border-accent shadow-ui-md' : ''
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="accent">Current plan</Badge>
                  </div>
                )}
                {plan === 'PRO' && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant={PLAN_BADGE.PRO}>Most popular</Badge>
                  </div>
                )}

                <div className="flex items-center gap-2 mb-3">
                  <Icon size={18} className={PLAN_ICON_TINT[plan]} />
                  <h3 className="text-[14px] font-semibold text-fg tracking-tight">{PLAN_NAMES[plan]}</h3>
                </div>

                <div className="mb-5">
                  {plan === 'CUSTOM' ? (
                    <>
                      <span className="text-[13px] text-fg-subtle">from </span>
                      <span className="text-[28px] font-semibold text-fg tracking-tight tabular-nums">{fmtUsd(interval === 'year' ? Math.round((pricing?.baseSeatPriceCents ?? 800) * monthsCharged / 12) : (pricing?.baseSeatPriceCents ?? 800))}</span>
                      <span className="text-[13px] text-fg-subtle">/seat/mo</span>
                    </>
                  ) : (
                    <>
                      <span className="text-[28px] font-semibold text-fg tracking-tight tabular-nums">${price}</span>
                      <span className="text-[13px] text-fg-subtle">/mo</span>
                      {interval === 'year' && monthly > 0 && <p className="text-[11.5px] text-success mt-0.5">billed ${monthly * monthsCharged}/year</p>}
                    </>
                  )}
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {FEATURES[plan].map(f => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-fg-muted leading-relaxed">
                      <CheckCircle size={13} className="text-success flex-shrink-0 mt-0.5" /> <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {/* One disabled state, two labels — this used to be two identical
                    buttons that differed only in their text. */}
                {plan === 'CUSTOM' ? (
                  <Link to="/billing/custom" data-testid="build-custom-licence">
                    <Button block variant={isCurrent ? 'secondary' : 'primary'} icon={<Sparkles size={14} />}>
                      {isCurrent ? 'Adjust licence' : 'Build your licence'}
                    </Button>
                  </Link>
                ) : locked ? (
                  <Button block variant="secondary" disabled title={plan === 'FREE' && !isCurrent ? 'Cancel your subscription from Manage billing to return to Free' : undefined}>
                    {isCurrent ? 'Current plan' : 'Downgrade via Manage billing'}
                  </Button>
                ) : (
                  <Button block loading={checkout.isPending} onClick={() => checkout.mutate({ plan, interval })}>
                    {current === 'FREE' ? 'Upgrade to' : 'Switch to'} {PLAN_NAMES[plan]}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>

        {/* Stripe setup note */}
        {!sub?.stripeCustomerId && sub?.plan === 'FREE' && (
          <Alert tone="warning" icon={<CreditCard size={15} />} title="Configure Stripe to enable payments">
            <p>Add <code className="bg-warning/15 px-1 rounded">STRIPE_SECRET_KEY</code> and <code className="bg-warning/15 px-1 rounded">STRIPE_WEBHOOK_SECRET</code> to <code className="bg-warning/15 px-1 rounded">server/.env</code>. Yearly and custom licences are priced dynamically; <code className="bg-warning/15 px-1 rounded">STRIPE_PRO_PRICE_ID</code> / <code className="bg-warning/15 px-1 rounded">STRIPE_ENTERPRISE_PRICE_ID</code> are optional monthly Prices.</p>
          </Alert>
        )}
      </PageBody>
    </div>
  );
}
