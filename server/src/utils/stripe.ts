import https from 'https';
import crypto from 'crypto';

// ─── Low-level Stripe REST helpers ────────────────────────────────────────────

function stripeRequest<T = any>(method: string, path: string, body?: Record<string, any>): Promise<T> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) return reject(new Error('STRIPE_SECRET_KEY not configured'));

    const params = body ? new URLSearchParams(flattenStripeParams(body)).toString() : '';
    const opts: https.RequestOptions = {
      hostname: 'api.stripe.com',
      port: 443,
      path: `/v1${path}`,
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params),
        'Stripe-Version': '2024-06-20',
      },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          resolve(json as T);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (params) req.write(params);
    req.end();
  });
}

// Flatten nested objects for Stripe's form encoding: { line_items: [{ price_data: { ... } }] }
function flattenStripeParams(obj: Record<string, any>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          Object.assign(result, flattenStripeParams(item, `${fullKey}[${i}]`));
        } else {
          result[`${fullKey}[${i}]`] = String(item);
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenStripeParams(value, fullKey));
    } else if (value !== undefined && value !== null) {
      result[fullKey] = String(value);
    }
  }
  return result;
}

// ─── Stripe API surface ───────────────────────────────────────────────────────

export const stripe = {
  customers: {
    create: (params: { email: string; name: string; metadata?: Record<string, string> }) =>
      stripeRequest('POST', '/customers', params),
    retrieve: (id: string) => stripeRequest('GET', `/customers/${id}`),
  },
  checkout: {
    sessions: {
      create: (params: {
        success_url: string;
        cancel_url: string;
        mode: 'subscription' | 'payment';
        customer?: string;
        customer_email?: string;
        line_items: (
          | { price: string; quantity: number }
          | {
              quantity: number;
              price_data: {
                currency: string;
                unit_amount: number;
                recurring: { interval: 'month' | 'year' };
                product_data: { name: string; description?: string; metadata?: Record<string, string> };
              };
            }
        )[];
        subscription_data?: { metadata?: Record<string, string> };
        allow_promotion_codes?: boolean;
        metadata?: Record<string, string>;
      }) => stripeRequest('POST', '/checkout/sessions', params),
    },
  },
  billingPortal: {
    sessions: {
      create: (params: { customer: string; return_url: string }) =>
        stripeRequest('POST', '/billing_portal/sessions', params),
    },
  },
  subscriptions: {
    retrieve: (id: string) => stripeRequest('GET', `/subscriptions/${id}`),
    cancel: (id: string) => stripeRequest('DELETE', `/subscriptions/${id}`),
  },
};

// ─── Webhook signature verification ──────────────────────────────────────────

export function verifyStripeWebhook(payload: Buffer, signature: string): any {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  const parts = signature.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {} as Record<string, string>);

  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  if (!timestamp || !expectedSig) throw new Error('Invalid Stripe signature header');

  const signedPayload = `${timestamp}.${payload.toString('utf8')}`;
  const hmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedSig))) {
    throw new Error('Stripe webhook signature mismatch');
  }

  // Replay attack protection: reject events older than 5 minutes
  const diff = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (diff > 300) throw new Error('Stripe webhook timestamp too old');

  return JSON.parse(payload.toString('utf8'));
}

// ─── Plan config ─────────────────────────────────────────────────────────────

// Feature keys gated by plan (see utils/licensing.ts requireFeature()).
// Deliberately coarse-grained: 25+ distinct AI endpoints all fall under the
// single 'ai_advanced' key rather than per-endpoint keys, since the actual
// business decision was binary (Free gets core lead-scoring/ticket-sentiment/
// auto-routing/auto-tagging; everything else AI-related is Pro+), not a
// per-feature matrix. Lead scoring, ticket sentiment, auto-routing, and
// auto-tagging are NOT listed here because they're free on every plan and
// have no gate at all.
export type FeatureKey = 'ai_advanced' | 'workflow_automation' | 'customer_portal' | 'advanced_analytics' | 'custom_branding';

// storageQuotaGB is how much of OUR storage (the "use our hosted storage"
// option in Settings → Storage, utils/s3Storage.ts) each plan gets, in
// gigabytes. 0 means the plan can't use it at all — those orgs must bring
// their own Google Drive instead, which costs us nothing. This is entirely
// separate from BYO-Drive, which has no quota on any plan since it's the
// customer's own storage.
export const PLANS = {
  FREE:       { name: 'Free',       seats: 5,   price: 0,    priceId: null, features: [] as FeatureKey[], storageQuotaGB: 0 },
  PRO:        { name: 'Pro',        seats: 25,  price: 49,   priceId: process.env.STRIPE_PRO_PRICE_ID || '',
    features: ['ai_advanced', 'workflow_automation', 'customer_portal', 'advanced_analytics'] as FeatureKey[], storageQuotaGB: 5 },
  ENTERPRISE: { name: 'Enterprise', seats: 999, price: 149,  priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
    features: ['ai_advanced', 'workflow_automation', 'customer_portal', 'advanced_analytics', 'custom_branding'] as FeatureKey[], storageQuotaGB: 50 },
  // Self-serve custom licence: seats, features and storage are stored on the
  // Subscription row itself (built on /billing/custom, priced in utils/pricing.ts),
  // so the static config here is intentionally empty — see licensing.ts
  // getEffectiveLicense() for how a CUSTOM row is read.
  CUSTOM:     { name: 'Custom',     seats: 0,   price: 0,    priceId: null, features: [] as FeatureKey[], storageQuotaGB: 0 },
} as const;

export type PlanKey = keyof typeof PLANS;
export function isPlanKey(v: unknown): v is PlanKey { return typeof v === 'string' && v in PLANS; }
