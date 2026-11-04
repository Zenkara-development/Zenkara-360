import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface PlatformSecretStatus {
  configured: boolean;
  source: 'database' | 'env' | null;
}

export interface PlatformSettings {
  s3Bucket: string | null;
  s3Region: string | null;
  s3Endpoint: string | null;
  s3AccessKeyId: PlatformSecretStatus;
  s3SecretAccessKey: PlatformSecretStatus;
  hostedStorageReady: boolean;
  effectiveStorage: { bucket: string | null; region: string; endpoint: string | null };
  resendFrom: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  twilioAccountSid: string | null;
  twilioFromNumber: string | null;
  resendApiKey: PlatformSecretStatus;
  smtpPass: PlatformSecretStatus;
  twilioAuthToken: PlatformSecretStatus;
  updatedAt: string | null;
}

export interface PlatformStorageTestResult {
  ok: boolean;
  step?: 'write' | 'read' | 'delete';
  error?: string;
  bucket?: string | null;
  endpoint?: string | null;
}

export interface PlatformSettingsUpdate {
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  resendApiKey?: string;
  resendFrom?: string;
  smtpHost?: string;
  smtpPort?: number | null;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
}

export interface SendCounts {
  email: { own: number; platform: number; total: number };
  whatsapp: { own: number; platform: number; total: number };
}

export interface PlatformOrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  createdAt: string;
  subscription: {
    plan: string;
    status: string;
    seats: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
    /** Per-org license limits set by the platform operator; null = plan default / unlimited. */
    storageQuotaOverrideGb: number | null;
    aiTokenLimitMonthly: number | null;
  } | null;
  branding: { companyName: string; logoUrl: string | null; primaryColor: string; supportEmail: string | null } | null;
  emailSending: { connected: boolean; email: string | null; smtpHost: string | null; lastSyncAt: string | null };
  whatsappSending: { connected: boolean; phoneNumber: string | null; notifyNumber: string | null };
  // "License" for attachments: which storage the org uses and, for our
  // hosted S3 option, quota vs usage — same numbers utils/licensing.ts
  // enforces server-side on every upload.
  storageLicense: { provider: 'GOOGLE_DRIVE' | 'HOSTED_S3' | null; connectedEmail: string | null; quotaBytes: number; usedBytes: number };
  // All-time email/WhatsApp sends, split by org's-own-account vs. platform fallback.
  sendCounts: SendCounts;
  counts: { users: number; contacts: number; tickets: number };
}

export interface PlatformOrgDetail extends Omit<PlatformOrgSummary, 'emailSending' | 'whatsappSending' | 'storageLicense' | 'counts'> {
  emailAccount: { email: string; imapHost: string; smtpHost: string; smtpPort: number; lastSyncAt: string | null } | null;
  whatsAppConfig: { phoneNumber: string; notifyNumber: string | null; createdAt: string } | null;
  storageConfig: { provider: 'GOOGLE_DRIVE' | 'HOSTED_S3'; connectedEmail: string | null; rootFolderId: string | null; updatedAt: string } | null;
  storageLicense: { quotaBytes: number; usedBytes: number };
  users: { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string }[];
  _count: { contacts: number; tickets: number; deals: number };
}

/** Platform-admin only: every org's plan/license/branding/sending-connection status (GET /platform/orgs). */
export const usePlatformOrgs = (enabled = true) =>
  useQuery({
    queryKey: ['platform-orgs'],
    queryFn: () => api.get('/platform/orgs').then(r => r.data as PlatformOrgSummary[]),
    enabled,
  });

/** Platform-admin only: single org detail incl. staff list (GET /platform/orgs/:id). */
export const usePlatformOrg = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: ['platform-orgs', id],
    queryFn: () => api.get(`/platform/orgs/${id}`).then(r => r.data as PlatformOrgDetail),
    enabled: enabled && !!id,
  });

// ─── Mutations (edit-from-console) ────────────────────────────────────────────
// Each invalidates both the list (['platform-orgs']) and the open detail panel
// (['platform-orgs', id]) so the table and the slide-over stay in sync without
// a manual refetch.

export const useUpdatePlatformOrg = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string }) =>
      api.patch(`/platform/orgs/${id}`, data).then(r => r.data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      qc.invalidateQueries({ queryKey: ['platform-orgs', id] });
    },
  });
};

export const useUpdatePlatformSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; plan?: string; seats?: number; status?: string; cancelAtPeriodEnd?: boolean; storageQuotaOverrideGb?: number | null; aiTokenLimitMonthly?: number | null }) =>
      api.patch(`/platform/orgs/${id}/subscription`, data).then(r => r.data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      qc.invalidateQueries({ queryKey: ['platform-orgs', id] });
    },
  });
};

export const useUpdatePlatformBranding = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; companyName?: string; logoUrl?: string | null; primaryColor?: string; supportEmail?: string | null }) =>
      api.patch(`/platform/orgs/${id}/branding`, data).then(r => r.data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      qc.invalidateQueries({ queryKey: ['platform-orgs', id] });
    },
  });
};

/** Platform-wide email/WhatsApp fallback config (GET /platform/settings) — see server/src/utils/platformSettings.ts. */
export const usePlatformSettings = (enabled = true) =>
  useQuery({
    queryKey: ['platform-settings'],
    queryFn: () => api.get('/platform/settings').then(r => r.data as PlatformSettings),
    enabled,
  });

export const useUpdatePlatformSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PlatformSettingsUpdate) => api.patch('/platform/settings', data).then(r => r.data as PlatformSettings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-settings'] }),
  });
};

/**
 * Round-trips a probe object against the hosted-storage bucket.
 *
 * Any field omitted is filled in server-side from the live config, so a test
 * after changing only the bucket does not require re-typing the secret key
 * (which the console never sends back to the browser in the first place).
 */
export const useTestPlatformStorage = () =>
  useMutation({
    mutationFn: (body: {
      bucket?: string; region?: string; endpoint?: string;
      accessKeyId?: string; secretAccessKey?: string;
    }) => api.post('/platform/settings/storage/test', body).then(r => r.data as PlatformStorageTestResult),
  });

// ─── Licence pricing (Platform Admin → Pricing) ──────────────────────────────

export interface PricingModule {
  key: string;
  name: string;
  description: string;
  pricePerSeatCents: number;
  enabled: boolean;
}

export interface PricingConfig {
  baseSeatPriceCents: number;
  planPrices: { PRO: number; ENTERPRISE: number };
  customStorageGb: number;
  yearlyMonthsCharged: number;
  gracePeriodDays: number;
  minSeats: number;
  maxSeats: number;
  volumeTiers: { minSeats: number; discountPct: number }[];
  modules: PricingModule[];
}

export interface PlatformPricing {
  effective: PricingConfig;
  defaults: PricingConfig;
  hasOverride: boolean;
  updatedAt: string | null;
}

/** The operator sends the full desired config; the server layers it over code defaults. */
export type PricingUpdate = Partial<Omit<PricingConfig, 'modules' | 'planPrices'>> & {
  planPrices?: Partial<PricingConfig['planPrices']>;
  modules?: ({ key: string } & Partial<Omit<PricingModule, 'key'>>)[];
};

export const usePlatformPricing = (enabled = true) =>
  useQuery({
    queryKey: ['platform-pricing'],
    queryFn: () => api.get('/platform/pricing').then(r => r.data as PlatformPricing),
    enabled,
  });

export const useUpdatePlatformPricing = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PricingUpdate) => api.put('/platform/pricing', data).then(r => r.data as PlatformPricing),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-pricing'] }); qc.invalidateQueries({ queryKey: ['billing-pricing'] }); },
  });
};

export const useResetPlatformPricing = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/platform/pricing').then(r => r.data as PlatformPricing),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-pricing'] }); qc.invalidateQueries({ queryKey: ['billing-pricing'] }); },
  });
};
