import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { encryptSecret } from '../../utils/crypto';
import * as googleDrive from '../../utils/googleDrive';
import * as s3Storage from '../../utils/s3Storage';
import * as storage from '../../utils/storage';
import { getStorageQuotaBytes, getHostedStorageUsageBytes } from '../../utils/licensing';
import { isHostedStorageConfigured } from '../../utils/platformSettings';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// The backend's own public URL — Google redirects the browser straight back
// here after consent, so this has to be reachable from the internet, not
// localhost. Reuses APP_URL, the same env var mailer.ts already relies on
// for CSAT survey links (the other place this codebase builds a link back
// to itself rather than to the frontend).
const APP_URL = process.env.APP_URL || 'http://localhost:4000';
const REDIRECT_URI = `${APP_URL}/api/storage/google/callback`;

interface OAuthState {
  orgId: string;
  userId: string;
}

/** Throws AppError(409) if the org currently has GOOGLE_DRIVE attachments
 * that `action` would strand — i.e. the org's active connection is still
 * that same Drive account, so those files are reachable right now, but
 * `action` is about to overwrite or remove the credentials they need
 * (disconnecting, switching to hosted storage, or reconnecting a
 * *different* Drive account). Deliberately does NOT block when the
 * attachments are already unreachable for some other reason (e.g. the org
 * already switched away previously) — no point blocking someone from
 * finishing a transition that already happened. */
async function assertWontOrphanDriveAttachments(orgId: string, action: string): Promise<void> {
  return assertWontOrphanAttachments(orgId, 'GOOGLE_DRIVE', action);
}

const PROVIDER_LABEL: Record<string, string> = {
  GOOGLE_DRIVE: 'connected Google Drive account',
  CUSTOM_S3: 'connected S3 bucket',
};

/**
 * Generalised from the Drive-only version. CUSTOM_S3 needs the identical
 * guard: the bucket name and keys live in one StorageConfig row, so switching
 * provider overwrites the only route back to files still sitting in the
 * customer's own bucket. The files are not lost — they are exactly where the
 * customer put them — but nothing in this product can reach them again.
 *
 * HOSTED_S3 is deliberately not guarded: those objects are in our bucket under
 * a key we control, and switching away leaves that unchanged.
 */
async function assertWontOrphanAttachments(orgId: string, provider: string, action: string): Promise<void> {
  const count = await storage.countAttachmentsByProvider(orgId, provider);
  if (count === 0) return;
  const where = PROVIDER_LABEL[provider] ?? 'connected storage';
  throw new AppError(
    409,
    `${action} would make ${count} attachment${count === 1 ? '' : 's'} stored in your ${where} permanently inaccessible in CRMITdesk (they'd remain where they are, just not reachable from here). Delete ${count === 1 ? 'it' : 'them'} first, or keep this connection.`,
  );
}

/** Whichever provider is active now and holds files that a change would strand. */
async function assertSwitchIsSafe(orgId: string, action: string): Promise<void> {
  const existing = await prisma.storageConfig.findUnique({ where: { orgId } });
  if (!existing) return;
  if (existing.provider === 'GOOGLE_DRIVE' || existing.provider === 'CUSTOM_S3') {
    await assertWontOrphanAttachments(orgId, existing.provider, action);
  }
}

// GET /api/storage/status
export async function getStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const config = await prisma.storageConfig.findUnique({ where: { orgId } });
    const quotaBytes = await getStorageQuotaBytes(orgId);
    const usedBytes = quotaBytes > 0 ? await getHostedStorageUsageBytes(orgId) : 0;

    res.json({
      configured: googleDrive.isGoogleDriveConfigured(),
      connected: !!config,
      provider: config?.provider || null,
      connectedEmail: config?.connectedEmail || null,
      connectedAt: config?.createdAt || null,
      // The org's own bucket, if that is what they connected. Never includes
      // the keys — only what is needed to show "you are pointed at THIS
      // bucket", so an admin can tell at a glance whether it is the right one.
      customS3: config?.provider === 'CUSTOM_S3' ? {
        label: config.s3Label || null,
        bucket: config.s3Bucket,
        region: config.s3Region,
        endpoint: config.s3Endpoint,
        prefix: config.s3Prefix,
      } : null,
      // Bring-your-own S3 needs nothing from the deployment — no OAuth app, no
      // shared bucket — so it is always offerable. That is the main reason it
      // is the widest-reach option: it works even on a deployment where
      // neither Google nor hosted storage was ever set up.
      customS3Available: true,
      hosted: {
        // Whether THIS deployment has a bucket for hosted storage at all,
        // from the platform console or the S3_* env vars.
        available: await isHostedStorageConfigured(),
        // Whether the org's PLAN includes any hosted storage at all — 0 on
        // Free, so those orgs only ever see the BYO-Drive option.
        quotaBytes,
        usedBytes,
      },
    });
  } catch (err) { next(err); }
}

// GET /api/storage/google/connect
export async function connectGoogleDrive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!googleDrive.isGoogleDriveConfigured()) {
      throw new AppError(400, 'Google Drive isn’t configured on this deployment yet (missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET).');
    }
    const state = jwt.sign(
      { orgId: req.user!.orgId, userId: req.user!.id } as OAuthState,
      process.env.JWT_SECRET!,
      { expiresIn: '10m' },
    );
    const url = googleDrive.getGoogleAuthUrl(REDIRECT_URI, state);
    res.json({ url });
  } catch (err) { next(err); }
}

// GET /api/storage/google/callback — Google redirects the user's browser
// here directly, so there's no Authorization header to authenticate with;
// the signed `state` param (minted in connectGoogleDrive above) is what
// proves which org/user initiated this and prevents CSRF.
export async function googleCallback(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

    if (oauthError) {
      return res.redirect(`${FRONTEND_URL}/storage?error=${encodeURIComponent(oauthError)}`);
    }
    if (!code || !state) throw new AppError(400, 'Missing code or state from Google');

    let payload: OAuthState;
    try {
      payload = jwt.verify(state, process.env.JWT_SECRET!) as OAuthState;
    } catch {
      throw new AppError(400, 'This connection link has expired or is invalid — try connecting again from Settings.');
    }

    const tokens = await googleDrive.exchangeCodeForTokens(code, REDIRECT_URI);
    if (!tokens.refresh_token) {
      // Happens if the org already granted consent before and Google didn't
      // re-issue a refresh_token (prompt=consent above should prevent this,
      // but fail with a clear message rather than silently storing nothing).
      throw new AppError(400, 'Google did not return a long-lived connection. Revoke this app’s access at myaccount.google.com/permissions and try connecting again.');
    }

    const connectedEmail = await googleDrive.getConnectedEmail(tokens.access_token);

    // Reconnecting the SAME Drive account just refreshes tokens — harmless.
    // Reconnecting a DIFFERENT one overwrites the credentials old Drive
    // attachments need, exactly like disconnecting does, just less
    // obviously — so it gets the same guard.
    const existing = await prisma.storageConfig.findUnique({ where: { orgId: payload.orgId } });
    if (existing?.provider === 'CUSTOM_S3') {
      await assertWontOrphanAttachments(payload.orgId, 'CUSTOM_S3', 'Switching to Google Drive');
    }
    if (existing?.provider === 'GOOGLE_DRIVE' && existing.connectedEmail && existing.connectedEmail !== connectedEmail) {
      await assertWontOrphanDriveAttachments(payload.orgId, `Connecting a different Google account (${connectedEmail} instead of ${existing.connectedEmail})`);
    }

    const rootFolderId = await googleDrive.createAppFolder(tokens.access_token, 'CRMITdesk Evolved Attachments');

    await prisma.storageConfig.upsert({
      where: { orgId: payload.orgId },
      create: {
        orgId: payload.orgId,
        provider: 'GOOGLE_DRIVE',
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: encryptSecret(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        rootFolderId,
        connectedEmail,
        connectedByUserId: payload.userId,
      },
      update: {
        provider: 'GOOGLE_DRIVE',
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: encryptSecret(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        rootFolderId,
        connectedEmail,
        s3Bucket: null,
        s3Region: null,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3SecretAccessKey: null,
        s3ForcePathStyle: null,
        s3Prefix: null,
        s3Label: null,
        connectedByUserId: payload.userId,
      },
    });

    res.redirect(`${FRONTEND_URL}/storage?connected=1`);
  } catch (err: any) {
    res.redirect(`${FRONTEND_URL}/storage?error=${encodeURIComponent(err.message || 'Connection failed')}`);
  }
}

// POST /api/storage/hosted/connect — switches the org to our hosted (S3)
// storage instead of Google Drive. No OAuth involved: just checks the
// plan's quota is non-zero and this deployment has S3 credentials set, then
// upserts a StorageConfig row with every Drive-only field left null. This
// only changes where NEW uploads go — files already uploaded to hosted
// storage under a previous connection are unaffected either way. Files
// uploaded to Google Drive are a different story: nulling the Drive fields
// here would strand them, so assertWontOrphanDriveAttachments blocks the
// switch while any exist (see storage.ts's getGoogleDriveConfig for what
// happens to an attachment that predates this guard).
export async function connectHosted(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!(await isHostedStorageConfigured())) {
      throw new AppError(400, 'Hosted storage isn’t configured on this deployment yet — a platform administrator needs to set a bucket and credentials in the platform console (or the S3_* environment variables).');
    }
    const orgId = req.user!.orgId;
    const quotaBytes = await getStorageQuotaBytes(orgId);
    if (quotaBytes === 0) {
      throw new AppError(402, 'Hosted storage isn’t included in your current plan. Upgrade to Pro or Enterprise, or connect your own Google Drive instead.');
    }

    await assertSwitchIsSafe(orgId, 'Switching to hosted storage');

    await prisma.storageConfig.upsert({
      where: { orgId },
      create: {
        orgId,
        provider: 'HOSTED_S3',
        connectedByUserId: req.user!.id,
      },
      update: {
        provider: 'HOSTED_S3',
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        rootFolderId: null,
        connectedEmail: null,
        // Clear the other provider's fields too. Leaving a stale bucket name
        // on the row would make the Storage page show a connection that is no
        // longer in use.
        s3Bucket: null,
        s3Region: null,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3SecretAccessKey: null,
        s3ForcePathStyle: null,
        s3Prefix: null,
        s3Label: null,
        connectedByUserId: req.user!.id,
      },
    });

    res.json({ message: 'Hosted storage connected. New attachments will upload here.' });
  } catch (err) { next(err); }
}

// DELETE /api/storage
export async function disconnect(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await assertSwitchIsSafe(orgId, 'Disconnecting');

    await prisma.storageConfig.deleteMany({ where: { orgId } });
    res.json({ message: 'Storage disconnected. Existing attachments already uploaded are unaffected until deleted individually.' });
  } catch (err) { next(err); }
}

// ─── Bring-your-own S3-compatible storage ────────────────────────────────────

/**
 * The presets the UI offers. Kept server-side as well as in the client so the
 * endpoint template is defined once — a customer choosing "Cloudflare R2"
 * should never have to know that the endpoint is
 * `https://<account-id>.r2.cloudflarestorage.com`.
 *
 * `Other` exists because this list will go stale: any S3-compatible gateway
 * works if the customer can supply an endpoint.
 */
export const S3_PRESETS = [
  { id: 'AWS_S3',       label: 'Amazon S3',            endpointTemplate: null,                                                  defaultRegion: 'us-east-1', forcePathStyle: false, regionRequired: true,  help: 'Region must match the bucket. No endpoint needed.' },
  { id: 'CLOUDFLARE_R2',label: 'Cloudflare R2',        endpointTemplate: 'https://{accountId}.r2.cloudflarestorage.com',        defaultRegion: 'auto',      forcePathStyle: true,  regionRequired: false, help: 'Find the account ID in the R2 dashboard URL. Region is always "auto".' },
  { id: 'WASABI',       label: 'Wasabi',               endpointTemplate: 'https://s3.{region}.wasabisys.com',                   defaultRegion: 'us-east-1', forcePathStyle: true,  regionRequired: true,  help: 'The region appears in the endpoint, so it must be correct.' },
  { id: 'BACKBLAZE_B2', label: 'Backblaze B2',         endpointTemplate: 'https://s3.{region}.backblazeb2.com',                 defaultRegion: 'us-west-004', forcePathStyle: true, regionRequired: true, help: 'Use an application key, not the master key. Region looks like us-west-004.' },
  { id: 'DO_SPACES',    label: 'DigitalOcean Spaces',  endpointTemplate: 'https://{region}.digitaloceanspaces.com',             defaultRegion: 'nyc3',      forcePathStyle: false, regionRequired: true,  help: 'Region is the datacentre code, e.g. nyc3, fra1, sgp1.' },
  { id: 'MINIO',        label: 'MinIO / self-hosted',  endpointTemplate: null,                                                  defaultRegion: 'us-east-1', forcePathStyle: true,  regionRequired: false, help: 'Enter the full URL of your MinIO server, including the port if it is not 443.' },
  { id: 'OTHER',        label: 'Other S3-compatible',  endpointTemplate: null,                                                  defaultRegion: 'auto',      forcePathStyle: true,  regionRequired: false, help: 'Any gateway that speaks the S3 API.' },
] as const;

// GET /api/storage/s3/presets
export async function s3Presets(_req: AuthRequest, res: Response) {
  res.json({ presets: S3_PRESETS });
}

const CustomS3Schema = z.object({
  label: z.string().max(60).optional(),
  bucket: z.string().trim().min(1).max(255),
  region: z.string().trim().max(60).optional(),
  // Validated as a URL rather than a bare hostname so a paste of
  // "s3.amazonaws.com" fails here with a clear message instead of inside the
  // SDK, where it surfaces as an unrelated signature error.
  endpoint: z.string().trim().url('Endpoint must be a full URL, starting with https://').max(300).optional().or(z.literal('')),
  accessKeyId: z.string().trim().min(1).max(300),
  secretAccessKey: z.string().trim().min(1).max(300),
  forcePathStyle: z.boolean().optional(),
  prefix: z.string().trim().max(200).optional(),
});

function toTarget(d: z.infer<typeof CustomS3Schema>) {
  return {
    bucket: d.bucket,
    region: d.region || 'auto',
    endpoint: d.endpoint || null,
    accessKeyId: d.accessKeyId,
    secretAccessKey: d.secretAccessKey,
    forcePathStyle: d.forcePathStyle ?? (d.endpoint ? true : false),
    prefix: d.prefix || null,
  };
}

/**
 * POST /api/storage/s3/test — round-trips a probe object without saving
 * anything.
 *
 * Separate from connect so the form can offer "Test connection" before the
 * customer commits, and so a failure is diagnosable without leaving a broken
 * config behind.
 */
export async function testCustomS3(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = CustomS3Schema.parse(req.body);
    const result = await s3Storage.testConnection(toTarget(data));
    res.json(result);
  } catch (err) { next(err); }
}

/**
 * POST /api/storage/s3/connect — points this org's attachments at a bucket
 * they own.
 *
 * The connection is tested before it is stored, always. Saving credentials
 * that turn out not to work means every upload fails afterwards with no clue
 * as to why, and the person who would have to debug it is usually not the
 * person who typed them in.
 */
export async function connectCustomS3(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = CustomS3Schema.parse(req.body);

    await assertSwitchIsSafe(orgId, 'Switching to your own S3 storage');

    const test = await s3Storage.testConnection(toTarget(data));
    if (!test.ok) {
      const verb = { write: 'upload a test file to', read: 'read a test file back from', delete: 'delete a test file from' }[test.step ?? 'write'];
      throw new AppError(400, `Could not ${verb} that bucket. ${test.error}`);
    }

    await prisma.storageConfig.upsert({
      where: { orgId },
      create: {
        orgId,
        provider: 'CUSTOM_S3',
        s3Bucket: data.bucket,
        s3Region: data.region || 'auto',
        s3Endpoint: data.endpoint || null,
        // Encrypted at rest with ENCRYPTION_KEY, same as the Google refresh
        // token. These open a door into the customer's own cloud account.
        s3AccessKeyId: encryptSecret(data.accessKeyId),
        s3SecretAccessKey: encryptSecret(data.secretAccessKey),
        s3ForcePathStyle: data.forcePathStyle ?? !!data.endpoint,
        s3Prefix: data.prefix || null,
        s3Label: data.label || null,
        connectedByUserId: req.user!.id,
      },
      update: {
        provider: 'CUSTOM_S3',
        s3Bucket: data.bucket,
        s3Region: data.region || 'auto',
        s3Endpoint: data.endpoint || null,
        s3AccessKeyId: encryptSecret(data.accessKeyId),
        s3SecretAccessKey: encryptSecret(data.secretAccessKey),
        s3ForcePathStyle: data.forcePathStyle ?? !!data.endpoint,
        s3Prefix: data.prefix || null,
        s3Label: data.label || null,
        // Clear the Drive fields — otherwise a stale token sits on the row.
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        rootFolderId: null,
        connectedEmail: null,
        connectedByUserId: req.user!.id,
      },
    });

    res.json({ message: `Connected. New attachments will upload to ${data.bucket}.` });
  } catch (err) { next(err); }
}

// ─── Usage calculator ────────────────────────────────────────────────────────

/**
 * GET /api/storage/usage — the storage calculator behind Settings → Storage.
 *
 * Answers three questions an admin actually asks: how much space is my data
 * using (total and split by record type and by provider), how much of my
 * hosted quota is left, and roughly how many more typical files fit. The
 * projection is deliberately simple — remaining quota ÷ this org's own
 * average file size — because that is the number people can reason about.
 */
export async function getUsageBreakdown(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;

    const [byEntity, byProvider, quotaBytes, recordCounts] = await Promise.all([
      prisma.attachment.groupBy({
        by: ['entityType'],
        where: { uploader: { orgId } },
        _sum: { fileSize: true },
        _count: { _all: true },
      }),
      prisma.attachment.groupBy({
        by: ['provider'],
        where: { uploader: { orgId } },
        _sum: { fileSize: true },
        _count: { _all: true },
      }),
      getStorageQuotaBytes(orgId),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { _count: { select: { contacts: true, tickets: true, deals: true, leads: true } } },
      }),
    ]);

    const totalBytes = byProvider.reduce((n, p) => n + (p._sum.fileSize ?? 0), 0);
    const totalFiles = byProvider.reduce((n, p) => n + p._count._all, 0);
    const hostedUsedBytes = byProvider.find(p => p.provider === 'HOSTED_S3')?._sum.fileSize ?? 0;
    const avgFileBytes = totalFiles > 0 ? Math.round(totalBytes / totalFiles) : 0;
    const remainingBytes = Math.max(0, quotaBytes - hostedUsedBytes);

    res.json({
      // Quota applies to HOSTED storage only — Drive/own-bucket files are the
      // customer's own space and count toward totals but never toward quota.
      quotaBytes,
      hostedUsedBytes,
      remainingBytes,
      totalBytes,
      totalFiles,
      avgFileBytes,
      // "About how many more typical files fit in my hosted quota?" Null when
      // the org has no files yet (no average to project from) or no quota.
      estRemainingFiles: quotaBytes > 0 && avgFileBytes > 0
        ? Math.floor(remainingBytes / avgFileBytes)
        : null,
      byEntity: byEntity
        .map(e => ({ entityType: e.entityType, files: e._count._all, bytes: e._sum.fileSize ?? 0 }))
        .sort((a, b) => b.bytes - a.bytes),
      byProvider: byProvider
        .map(p => ({ provider: p.provider, files: p._count._all, bytes: p._sum.fileSize ?? 0 }))
        .sort((a, b) => b.bytes - a.bytes),
      records: recordCounts?._count ?? { contacts: 0, tickets: 0, deals: 0, leads: 0 },
    });
  } catch (err) { next(err); }
}
