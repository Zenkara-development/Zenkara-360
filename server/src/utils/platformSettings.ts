import { prisma } from './prisma';
import { encryptSecret, decryptSecretOrPlain } from './crypto';

/**
 * Platform-wide email/WhatsApp *fallback* sending config — the account used
 * when an org hasn't connected its own (utils/mailer.ts, utils/whatsapp.ts).
 * Previously only configurable via Render env vars; now a PLATFORM_ADMIN can
 * override any field live from the console (platform-admin.controller.ts's
 * getSettings/updateSettings), stored in the single PlatformSettings row.
 *
 * Every getter here layers DB over env: a field left blank in the console
 * falls back to the matching env var, so partial configuration (e.g. only
 * overriding the Twilio number, keeping Resend on its env var) works fine.
 */

const SINGLETON_ID = 'platform';

async function getRow() {
  return prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } });
}

export interface PlatformMailConfig {
  resendApiKey: string | null;
  resendFrom: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string | null;
}

/** Resolved email fallback config — mailer.ts calls this instead of reading process.env directly. */
export async function getPlatformMailConfig(): Promise<PlatformMailConfig> {
  const row = await getRow();
  return {
    resendApiKey: row?.resendApiKey ? decryptSecretOrPlain(row.resendApiKey) : (process.env.RESEND_API_KEY || null),
    resendFrom: row?.resendFrom || process.env.RESEND_FROM || null,
    smtpHost: row?.smtpHost || process.env.SMTP_HOST || null,
    smtpPort: row?.smtpPort ?? (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null),
    smtpUser: row?.smtpUser || process.env.SMTP_USER || null,
    smtpPass: row?.smtpPass ? decryptSecretOrPlain(row.smtpPass) : (process.env.SMTP_PASS || null),
    smtpFrom: row?.smtpFrom || process.env.SMTP_FROM || null,
  };
}

export interface PlatformWhatsAppConfig {
  accountSid: string | null;
  authToken: string | null;
  fromNumber: string | null;
}

/** Resolved WhatsApp fallback config — whatsapp.ts calls this instead of reading process.env directly. */
export async function getPlatformWhatsAppConfig(): Promise<PlatformWhatsAppConfig> {
  const row = await getRow();
  return {
    accountSid: row?.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || null,
    authToken: row?.twilioAuthToken ? decryptSecretOrPlain(row.twilioAuthToken) : (process.env.TWILIO_AUTH_TOKEN || null),
    fromNumber: row?.twilioFromNumber || process.env.TWILIO_FROM_NUMBER || null,
  };
}

export interface PlatformStorageConfig {
  bucket: string | null;
  region: string;
  endpoint: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
}

/**
 * The shared bucket behind provider 'HOSTED_S3'.
 *
 * Same DB-over-env layering as mail and WhatsApp above, and for the same
 * reason: changing where every customer's attachments land should not require
 * a redeploy of the API. Each field falls back independently, so overriding
 * only the bucket while leaving the credentials in the environment works.
 */
export async function getPlatformStorageConfig(): Promise<PlatformStorageConfig> {
  const row = await getRow();
  return {
    bucket: row?.s3Bucket || process.env.S3_BUCKET || null,
    region: row?.s3Region || process.env.S3_REGION || 'auto',
    endpoint: row?.s3Endpoint || process.env.S3_ENDPOINT || null,
    accessKeyId: row?.s3AccessKeyId ? decryptSecretOrPlain(row.s3AccessKeyId) : (process.env.S3_ACCESS_KEY_ID || null),
    secretAccessKey: row?.s3SecretAccessKey ? decryptSecretOrPlain(row.s3SecretAccessKey) : (process.env.S3_SECRET_ACCESS_KEY || null),
  };
}

/**
 * Whether hosted storage can work at all on this deployment. Async now,
 * because the answer can come from the database as well as the environment —
 * it used to be a synchronous read of process.env in s3Storage.ts.
 */
export async function isHostedStorageConfigured(): Promise<boolean> {
  const c = await getPlatformStorageConfig();
  return !!(c.bucket && c.accessKeyId && c.secretAccessKey);
}

export interface PlatformSettingsAdminView {
  // Non-secret DB-stored overrides — null means "not overridden, falling back to the env var (if any)".
  resendFrom: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  twilioAccountSid: string | null;
  twilioFromNumber: string | null;
  s3Bucket: string | null;
  s3Region: string | null;
  s3Endpoint: string | null;
  // Secrets are never sent back to the client — just whether one is set, and where it came from.
  resendApiKey: { configured: boolean; source: 'database' | 'env' | null };
  smtpPass: { configured: boolean; source: 'database' | 'env' | null };
  twilioAuthToken: { configured: boolean; source: 'database' | 'env' | null };
  s3AccessKeyId: { configured: boolean; source: 'database' | 'env' | null };
  s3SecretAccessKey: { configured: boolean; source: 'database' | 'env' | null };
  /** Whether bucket + both credentials resolve to something, from either source. */
  hostedStorageReady: boolean;
  /** What HOSTED_S3 would actually use right now, secrets excluded. */
  effectiveStorage: { bucket: string | null; region: string; endpoint: string | null };
  updatedAt: string | null;
}

/** GET /platform/settings shape — safe to send to the client (secrets reduced to a configured/source flag). */
export async function getPlatformSettingsForAdmin(): Promise<PlatformSettingsAdminView> {
  const row = await getRow();
  const secretStatus = (dbValue: string | null | undefined, envValue: string | undefined): { configured: boolean; source: 'database' | 'env' | null } => {
    if (dbValue) return { configured: true, source: 'database' };
    if (envValue) return { configured: true, source: 'env' };
    return { configured: false, source: null };
  };

  return {
    resendFrom: row?.resendFrom ?? null,
    smtpHost: row?.smtpHost ?? null,
    smtpPort: row?.smtpPort ?? null,
    smtpUser: row?.smtpUser ?? null,
    smtpFrom: row?.smtpFrom ?? null,
    twilioAccountSid: row?.twilioAccountSid ?? null,
    twilioFromNumber: row?.twilioFromNumber ?? null,
    resendApiKey: secretStatus(row?.resendApiKey, process.env.RESEND_API_KEY),
    smtpPass: secretStatus(row?.smtpPass, process.env.SMTP_PASS),
    twilioAuthToken: secretStatus(row?.twilioAuthToken, process.env.TWILIO_AUTH_TOKEN),
    s3Bucket: row?.s3Bucket ?? null,
    s3Region: row?.s3Region ?? null,
    s3Endpoint: row?.s3Endpoint ?? null,
    s3AccessKeyId: secretStatus(row?.s3AccessKeyId, process.env.S3_ACCESS_KEY_ID),
    s3SecretAccessKey: secretStatus(row?.s3SecretAccessKey, process.env.S3_SECRET_ACCESS_KEY),
    hostedStorageReady: !!(
      (row?.s3Bucket || process.env.S3_BUCKET) &&
      (row?.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID) &&
      (row?.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY)
    ),
    // Resolved, so the console shows what is LIVE rather than what was typed.
    // A blank field in the form does not mean "nothing" — it means "whatever
    // the environment says", and that distinction is the whole point of the
    // layering.
    effectiveStorage: {
      bucket: row?.s3Bucket || process.env.S3_BUCKET || null,
      region: row?.s3Region || process.env.S3_REGION || 'auto',
      endpoint: row?.s3Endpoint || process.env.S3_ENDPOINT || null,
    },
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export interface PlatformSettingsUpdateInput {
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
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
}

// The access key ID is treated as a secret alongside the secret key. It is
// not one strictly speaking, but it identifies an account in someone's cloud
// billing relationship and there is no reason to hand it back to a browser.
const SECRET_FIELDS = new Set(['resendApiKey', 'smtpPass', 'twilioAuthToken', 's3AccessKeyId', 's3SecretAccessKey']);

/**
 * Applies a partial update to the singleton row. PATCH semantics per field:
 *  - omitted entirely      → left untouched
 *  - empty string ("") / null → cleared back to null, i.e. "go back to using the env var"
 *  - any other value       → stored (encrypted first, for the three secret fields)
 */
export async function upsertPlatformSettings(input: PlatformSettingsUpdateInput): Promise<void> {
  const data: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (value === null || (typeof value === 'string' && value.trim() === '')) {
      data[key] = null;
    } else if (SECRET_FIELDS.has(key) && typeof value === 'string') {
      data[key] = encryptSecret(value);
    } else {
      data[key] = value;
    }
  }
  if (Object.keys(data).length === 0) return;

  await prisma.platformSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
}
