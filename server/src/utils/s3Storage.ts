import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Everything that speaks the S3 API, for both of the ways this product uses it:
 *
 *  - **HOSTED_S3** — our shared bucket, one for every org, objects namespaced
 *    by `orgId`. Configured platform-wide (PlatformSettings row, falling back
 *    to `S3_*` env vars — see utils/platformSettings.ts).
 *  - **CUSTOM_S3** — a bucket the *customer* owns, with credentials they
 *    supplied on the Storage page. Their bucket, their bill, their region and
 *    retention rules. This is the answer for a customer who will not put data
 *    in someone else's Google Drive or in ours.
 *
 * Both go through the same three functions. The only difference is which
 * `S3Target` gets passed in, which is why this file no longer reads
 * `process.env` at all — it used to, and that hardcoding was exactly what made
 * a per-customer bucket impossible.
 *
 * "S3-compatible" is doing real work here: AWS S3, Cloudflare R2, Wasabi,
 * Backblaze B2, DigitalOcean Spaces and MinIO all speak this protocol, so one
 * provider covers all of them. Azure Blob does NOT — different API entirely.
 *
 * The official @aws-sdk/client-s3 is used rather than hand-rolled HTTPS (the
 * convention elsewhere in this codebase, see stripe.ts / googleDrive.ts)
 * because SigV4 request signing is involved enough that a subtly wrong
 * implementation fails as an opaque 403 rather than something visible in
 * review.
 */

export interface S3Target {
  bucket: string;
  region: string;
  /** Omitted for real AWS S3; required for R2/Wasabi/B2/Spaces/MinIO. */
  endpoint?: string | null;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Path-style addressing (`host/bucket/key`) instead of virtual-host style
   * (`bucket.host/key`). Most non-AWS gateways need it; AWS itself is
   * deprecating it. Defaults to "on whenever a custom endpoint is set", which
   * is the right guess for every provider in the preset list, but a customer
   * on an unusual gateway can override it.
   */
  forcePathStyle?: boolean | null;
  /** Optional key prefix, so a customer can point us inside a shared bucket. */
  prefix?: string | null;
}

export class S3ConfigError extends Error {}

/**
 * Error codes S3 itself returns. Used to tell a genuine S3 rejection apart
 * from a network device answering in its place — the SDK puts both in `name`.
 */
const KNOWN_S3_CODES = new Set([
  'NoSuchBucket', 'NoSuchKey', 'AccessDenied', 'InvalidAccessKeyId',
  'SignatureDoesNotMatch', 'PermanentRedirect', 'AuthorizationHeaderMalformed',
  'NotFound', 'BucketNotEmpty', 'InvalidBucketName', 'RequestTimeTooSkewed',
]);

function client(target: S3Target): S3Client {
  if (!target.bucket) throw new S3ConfigError('No S3 bucket configured');
  if (!target.accessKeyId || !target.secretAccessKey) throw new S3ConfigError('No S3 credentials configured');

  return new S3Client({
    region: target.region || 'auto',
    endpoint: target.endpoint || undefined,
    forcePathStyle: target.forcePathStyle ?? !!target.endpoint,
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
    // Fail fast rather than hanging a user's upload request on a wrong
    // endpoint. The SDK default retries three times with no connect timeout,
    // which turns a typo in the endpoint into a 60-second spinner.
    requestHandler: { requestTimeout: 30_000, connectionTimeout: 8_000 } as any,
    maxAttempts: 3,
  });
}

/** Normalises a prefix to `a/b/` form — no leading slash, exactly one trailing. */
function normalisePrefix(prefix?: string | null): string {
  const p = (prefix ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return p ? `${p}/` : '';
}

/**
 * Uploads and returns the object key, stored as `Attachment.providerFileId`.
 *
 * The key embeds the orgId even for CUSTOM_S3, where the whole bucket belongs
 * to one org and namespacing is not strictly needed — it costs nothing and
 * keeps one key format across both providers, so a support question about a
 * stray object has the same answer either way.
 */
export async function uploadObject(
  target: S3Target,
  orgId: string,
  file: { buffer: Buffer; filename: string; mimeType: string },
): Promise<string> {
  const key = `${normalisePrefix(target.prefix)}${orgId}/${Date.now()}-${crypto.randomUUID()}-${file.filename}`;
  await client(target).send(new PutObjectCommand({
    Bucket: target.bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimeType,
  }));
  return key;
}

export async function downloadObject(target: S3Target, key: string): Promise<Buffer> {
  const res = await client(target).send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
  const chunks: Buffer[] = [];
  // res.Body is a Node Readable stream in the Node runtime of this SDK.
  for await (const chunk of res.Body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(target: S3Target, key: string): Promise<void> {
  try {
    await client(target).send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }));
  } catch (err: any) {
    // Swallow "already gone" the same way googleDrive-backed deletes do —
    // the point of this call is making sure it's gone, and it is.
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return;
    throw err;
  }
}

export interface S3TestResult {
  ok: boolean;
  /** Which step failed, so the message can be specific about the permission. */
  step?: 'write' | 'read' | 'delete';
  error?: string;
}

/**
 * Round-trips a small probe object: PUT, GET, DELETE.
 *
 * Credentials are never saved without this passing. A bucket that accepts
 * writes but not deletes, or a key with `s3:PutObject` but no `s3:GetObject`,
 * looks completely fine at connect time and then fails weeks later when
 * someone tries to open a file — by which point nobody connects the two
 * events. Better to find out now, and to say which of the three verbs was
 * refused so the customer can fix the exact IAM statement.
 */
export async function testConnection(target: S3Target): Promise<S3TestResult> {
  const key = `${normalisePrefix(target.prefix)}_crmitdesk-connection-test/${crypto.randomUUID()}.txt`;
  const body = Buffer.from('CRMITdesk storage connection test. Safe to delete.\n');
  const c = client(target);

  try {
    await c.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: body, ContentType: 'text/plain' }));
  } catch (err: any) {
    return { ok: false, step: 'write', error: explain(err) };
  }

  try {
    const res = await c.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    // Drain the stream — some gateways only surface an auth failure here.
    for await (const _ of res.Body as AsyncIterable<Buffer>) { /* discard */ }
  } catch (err: any) {
    // Leave no litter behind even when the read leg fails.
    await c.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    return { ok: false, step: 'read', error: explain(err) };
  }

  try {
    await c.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }));
  } catch (err: any) {
    return { ok: false, step: 'delete', error: explain(err) };
  }

  return { ok: true };
}

/**
 * Turns an SDK error into something a customer can act on. The raw messages
 * are either cryptic ("The request signature we calculated does not match")
 * or misleading (a wrong region often surfaces as `NoSuchBucket`).
 */
function explain(err: any): string {
  // The SDK surfaces an S3 error code in `name` (and sometimes `Code`) only
  // when the endpoint actually returned an S3 XML error body. Anything else —
  // a proxy, a captive portal, an HTML 404 page, a load balancer — arrives as
  // a parse failure with a bare HTTP status, and must NOT be reported as a
  // permission problem. Saying "your key is not allowed to do that" when the
  // truth is "that host is not S3" sends people to rewrite an IAM policy that
  // was correct all along.
  const name: string = err?.name || err?.Code || '';
  const status: number | undefined = err?.$metadata?.httpStatusCode;
  const message: string = err?.message ?? '';
  const isS3Error = !!(err?.Code || KNOWN_S3_CODES.has(name));

  if (err instanceof S3ConfigError) return err.message;

  // ── Network, before anything status-based ──
  if (name === 'ENOTFOUND' || /getaddrinfo|ENOTFOUND/i.test(message)) {
    return 'That endpoint hostname does not resolve. Check it for typos.';
  }
  if (name === 'ECONNREFUSED' || /ECONNREFUSED/i.test(message)) {
    return 'Nothing is listening at that endpoint. Check the URL and the port.';
  }
  if (name === 'TimeoutError' || name === 'ETIMEDOUT' || /timeout|ETIMEDOUT/i.test(message)) {
    return 'The endpoint did not respond in time. Check it is reachable from this server — a firewall or egress proxy will look exactly like this.';
  }
  if (/self.signed|unable to verify|CERT_/i.test(message)) {
    return "The endpoint's TLS certificate could not be verified. Common on a self-hosted MinIO with a self-signed certificate.";
  }
  // The endpoint answered, but not with S3.
  if (/XML parse error|Deserialization error|Unexpected token/i.test(message)) {
    return `That endpoint answered with something that is not an S3 response${status ? ` (HTTP ${status})` : ''}. It is usually the wrong URL, or a proxy or firewall answering on its behalf.`;
  }

  // ── Real S3 errors ──
  if (name === 'NoSuchBucket') return 'That bucket does not exist — check the bucket name, and that the region matches the one it was created in.';
  if (name === 'InvalidAccessKeyId') return 'That access key ID is not recognised by this provider.';
  if (name === 'SignatureDoesNotMatch') return 'The secret access key does not match the key ID (or the region is wrong — the region is part of the signature).';
  if (name === 'PermanentRedirect' || name === 'AuthorizationHeaderMalformed') return 'Wrong region for this bucket — the provider redirected us. Check the region setting.';
  if (name === 'AccessDenied') return 'The credentials are valid but not allowed to do that. The key needs s3:PutObject, s3:GetObject and s3:DeleteObject on this bucket.';
  if (name === 'NoSuchKey' || name === 'NotFound') return 'The endpoint responded but the object or bucket was not found there. Check the endpoint URL and the bucket name.';

  // ── Status fallbacks, only once we know it really was S3 talking ──
  if (isS3Error && status === 403) return 'The credentials are valid but not allowed to do that. The key needs s3:PutObject, s3:GetObject and s3:DeleteObject on this bucket.';
  if (status === 403) return 'The endpoint refused the request with HTTP 403 but did not return an S3 error. That is usually a proxy or firewall in front of the endpoint rather than a bucket permission.';
  if (status === 404) return 'The endpoint returned HTTP 404. Check the endpoint URL and the bucket name.';
  if (status && status >= 500) return `The storage provider returned HTTP ${status}. That is a fault on their side — try again shortly.`;

  return message || 'The storage provider rejected the request.';
}
