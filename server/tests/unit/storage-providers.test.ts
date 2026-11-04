/**
 * Guards for multi-provider attachment storage.
 *
 * Two things are being protected here, and they are different in kind.
 *
 * The first is a *containment* property: a customer who connects their own
 * bucket did so because the data must not sit with us. Any code path that
 * quietly falls back to hosted storage when their config is incomplete would
 * put it there anyway, silently, and nobody would notice until an audit. That
 * is the worst failure this feature can have, so it gets a structural test.
 *
 * The second is that credentials to someone else's cloud account are never
 * stored in the clear and never sent back to a browser.
 *
 *     npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const CLIENT = path.join(ROOT, '../client/src');

function read(...p: string[]): string { return fs.readFileSync(path.join(...p), 'utf8'); }
function code(...p: string[]): string {
  return read(...p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
/** The body of one `if (config.provider === 'X') { … }` branch. */
function branch(src: string, provider: string): string {
  const start = src.indexOf(`config.provider === '${provider}'`);
  assert.ok(start > -1, `no ${provider} branch found`);
  const end = src.indexOf('\n  }', start);
  return src.slice(start, end > -1 ? end : undefined);
}

// ─── Containment ──────────────────────────────────────────────────────────────

test('the S3 layer reads no environment variables of its own', () => {
  const s3 = code(SRC, 'utils/s3Storage.ts');
  // It used to read S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
  // directly, which is precisely what made a per-customer bucket impossible:
  // there was one global target and no way to pass another.
  assert.ok(
    !/process\.env/.test(s3),
    'utils/s3Storage.ts must take an explicit S3Target — reading process.env reintroduces a single global bucket',
  );
  assert.match(s3, /export interface S3Target/);
  for (const fn of ['uploadObject', 'downloadObject', 'deleteObject']) {
    assert.match(
      s3,
      new RegExp(`export async function ${fn}\\(\\s*target: S3Target`),
      `${fn} must take the target as its first argument`,
    );
  }
});

test('a customer bucket never silently falls back to ours', () => {
  const storage = code(SRC, 'utils/storage.ts');
  const custom = storage.slice(storage.indexOf('function customTarget('), storage.indexOf('async function getCustomS3Target('));

  // An incomplete CUSTOM_S3 row must throw. Returning a hosted target here, or
  // returning null and letting the caller pick a default, would write a
  // customer's files into our bucket after they explicitly chose not to.
  assert.match(custom, /throw new AppError/, 'an incomplete CUSTOM_S3 config must throw, not degrade');
  assert.ok(!/hostedTarget/.test(custom), 'customTarget must never resolve to the hosted bucket');
});

test('all three verbs handle CUSTOM_S3, or files become unreachable', () => {
  const storage = code(SRC, 'utils/storage.ts');
  // Upload without download is a data-loss bug that only shows up later: the
  // file goes in fine and cannot come back out.
  for (const fn of ['uploadAttachment', 'downloadAttachment', 'deleteAttachmentFile']) {
    const start = storage.indexOf(`export async function ${fn}(`);
    assert.ok(start > -1, `${fn} must exist`);
    const body = storage.slice(start, storage.indexOf('\n}', start));
    assert.match(body, /CUSTOM_S3/, `${fn} must handle CUSTOM_S3`);
    assert.match(body, /HOSTED_S3/, `${fn} must handle HOSTED_S3`);
    assert.match(body, /GOOGLE_DRIVE/, `${fn} must handle GOOGLE_DRIVE`);
  }
});

test("a customer's own bucket is not metered against our plan quota", () => {
  const storage = code(SRC, 'utils/storage.ts');
  const upload = storage.slice(storage.indexOf('export async function uploadAttachment('));
  const customArm = branch(upload, 'CUSTOM_S3');
  // It is their bucket and their bill. Charging a plan quota against storage
  // we do not provide would be wrong, and would block uploads for no reason.
  assert.ok(
    !/assertHostedStorageAvailable/.test(customArm),
    'CUSTOM_S3 uploads must not consume the hosted-storage quota',
  );
});

// ─── Credentials ──────────────────────────────────────────────────────────────

test('customer S3 credentials are encrypted before they are stored', () => {
  const controller = code(SRC, 'modules/storage/storage.controller.ts');
  const connect = controller.slice(controller.indexOf('export async function connectCustomS3('));

  for (const field of ['s3AccessKeyId', 's3SecretAccessKey']) {
    const assignments = [...connect.matchAll(new RegExp(`${field}:\\s*([^,\\n]+)`, 'g'))].map(m => m[1].trim());
    assert.ok(assignments.length >= 2, `${field} must be written on both create and update`);
    for (const value of assignments) {
      assert.match(value, /^encryptSecret\(/, `${field} must be encrypted, got: ${value}`);
    }
  }
});

test('credentials are never returned to the browser', () => {
  const controller = code(SRC, 'modules/storage/storage.controller.ts');
  const status = controller.slice(controller.indexOf('export async function getStatus('), controller.indexOf('export async function connectGoogleDrive('));

  assert.match(status, /customS3/, 'the status payload must say which bucket is connected');
  for (const secret of ['s3AccessKeyId', 's3SecretAccessKey', 'accessToken', 'refreshToken']) {
    assert.ok(!status.includes(secret), `GET /storage/status must not include ${secret}`);
  }

  const platform = code(SRC, 'utils/platformSettings.ts');
  const adminView = platform.slice(platform.indexOf('export async function getPlatformSettingsForAdmin('));
  // The admin view may report *whether* a secret is set and where it came
  // from, never the value.
  assert.match(adminView, /s3AccessKeyId: secretStatus\(/);
  assert.match(adminView, /s3SecretAccessKey: secretStatus\(/);
  assert.ok(!/decryptSecretOrPlain/.test(adminView), 'the admin view must not decrypt anything');
});

test('the connection is proven before credentials are saved', () => {
  const controller = code(SRC, 'modules/storage/storage.controller.ts');
  const connect = controller.slice(controller.indexOf('export async function connectCustomS3('));

  const testAt = connect.indexOf('testConnection');
  const saveAt = connect.indexOf('storageConfig.upsert');
  assert.ok(testAt > -1, 'connect must test the bucket');
  assert.ok(saveAt > -1, 'connect must save the config');
  assert.ok(testAt < saveAt, 'the test must run BEFORE the upsert — saving credentials that do not work means every later upload fails with no clue why');
  assert.match(connect, /if \(!test\.ok\)/, 'a failed test must abort the connect');
});

test('the probe covers write, read AND delete', () => {
  const s3 = code(SRC, 'utils/s3Storage.ts');
  const fn = s3.slice(s3.indexOf('export async function testConnection('));
  // A key with PutObject but no DeleteObject passes a write-only check and
  // then quietly accumulates files the customer pays for and cannot remove.
  assert.match(fn, /PutObjectCommand/);
  assert.match(fn, /GetObjectCommand/);
  assert.match(fn, /DeleteObjectCommand/);
  assert.match(fn, /step: 'write'/);
  assert.match(fn, /step: 'read'/);
  assert.match(fn, /step: 'delete'/);
});

// ─── Switching providers ──────────────────────────────────────────────────────

test('switching provider cannot strand files in a bring-your-own bucket', () => {
  const controller = code(SRC, 'modules/storage/storage.controller.ts');
  const guard = controller.slice(controller.indexOf('async function assertWontOrphanAttachments('), controller.indexOf('async function assertSwitchIsSafe('));

  // Both bring-your-own providers keep their only route back to the files in
  // one StorageConfig row; overwriting it makes those files unreachable.
  const safe = controller.slice(controller.indexOf('async function assertSwitchIsSafe('), controller.indexOf('export async function getStatus('));
  assert.match(safe, /GOOGLE_DRIVE/);
  assert.match(safe, /CUSTOM_S3/);
  assert.match(guard, /409/, 'stranding files must be refused, not warned about');

  // HOSTED_S3 is intentionally NOT guarded — those objects are in our bucket
  // under a key we control and survive a provider switch.
  assert.ok(!/'HOSTED_S3'/.test(safe), 'hosted storage does not need the orphan guard');

  for (const fn of ['connectHosted', 'connectCustomS3', 'disconnect']) {
    const start = controller.indexOf(`export async function ${fn}(`);
    const body = controller.slice(start, controller.indexOf('\n}', start));
    assert.match(body, /assertSwitchIsSafe|assertWontOrphan/, `${fn} must run the orphan guard`);
  }
});

test('connecting one provider clears the other provider’s fields', () => {
  const controller = code(SRC, 'modules/storage/storage.controller.ts');
  // A stale bucket name or Drive token left on the row makes the Storage page
  // report a connection that is no longer in use.
  const custom = controller.slice(controller.indexOf('export async function connectCustomS3('));
  assert.match(custom, /accessToken: null/);
  assert.match(custom, /rootFolderId: null/);

  const hosted = controller.slice(controller.indexOf('export async function connectHosted('), controller.indexOf('export async function disconnect('));
  assert.match(hosted, /s3Bucket: null/);
  assert.match(hosted, /s3SecretAccessKey: null/);
});

// ─── Platform-wide configuration ──────────────────────────────────────────────

test('hosted storage resolves database over environment, per field', () => {
  const platform = code(SRC, 'utils/platformSettings.ts');
  const fn = platform.slice(platform.indexOf('export async function getPlatformStorageConfig('), platform.indexOf('export async function isHostedStorageConfigured('));

  // Each field falls back on its own, so overriding only the bucket while
  // leaving credentials in the environment works.
  for (const [field, env] of [['bucket', 'S3_BUCKET'], ['region', 'S3_REGION'], ['endpoint', 'S3_ENDPOINT'], ['accessKeyId', 'S3_ACCESS_KEY_ID'], ['secretAccessKey', 'S3_SECRET_ACCESS_KEY']]) {
    assert.match(fn, new RegExp(`${field}:.*process\\.env\\.${env}`), `${field} must fall back to ${env}`);
  }
  assert.match(fn, /decryptSecretOrPlain\(row\.s3AccessKeyId\)/);
  assert.match(fn, /decryptSecretOrPlain\(row\.s3SecretAccessKey\)/);
});

test('nothing reads the S3 env vars directly any more', () => {
  // If any caller still reads process.env.S3_* to decide behaviour, the
  // console override is a lie: the UI would say one thing and uploads would
  // do another. platformSettings.ts is the one permitted reader.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      if (full.endsWith('utils/platformSettings.ts')) continue;
      if (/process\.env\.S3_/.test(code(full))) offenders.push(path.relative(SRC, full));
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], `these read S3_* directly instead of going through platformSettings: ${offenders.join(', ')}`);
});

test('the platform console exposes storage, and can prove it works', () => {
  const routes = code(SRC, 'modules/platform-admin/platformAdmin.routes.ts');
  assert.match(routes, /settings\/storage\/test/, 'a connection test must be reachable');

  const controller = code(SRC, 'modules/platform-admin/platformAdmin.controller.ts');
  // optionalText() is the zodHelpers wrapper around z.string() that treats
  // null/'' as "not provided" — the schema moved to it, so match either form.
  assert.match(controller, /s3Bucket: (optionalText\(\)|z\.string\(\))/, 'the settings PATCH must accept the storage fields');
  assert.match(controller, /s3SecretAccessKey: (optionalText\(\)|z\.string\(\))/);

  const platform = code(SRC, 'utils/platformSettings.ts');
  const secrets = platform.slice(platform.indexOf('const SECRET_FIELDS'));
  assert.match(secrets, /s3AccessKeyId/, 'the access key must be encrypted on write');
  assert.match(secrets, /s3SecretAccessKey/, 'the secret key must be encrypted on write');
});

// ─── Client ───────────────────────────────────────────────────────────────────

test('the connect form is reachable from the Storage page', () => {
  if (!fs.existsSync(CLIENT)) return; // server-only checkout
  const page = read(CLIENT, 'pages/StoragePage.tsx');
  assert.match(page, /CustomS3Form/, 'the S3 form must be mounted');
  assert.match(page, /CUSTOM_S3/, 'the page must render the connected state for an own bucket');

  const form = read(CLIENT, 'pages/storage/CustomS3Form.tsx');
  assert.match(form, /type="password"/, 'the secret key field must be masked');
  assert.match(form, /Test connection/);
});

test('client and server agree on the S3 preset list', () => {
  if (!fs.existsSync(CLIENT)) return;
  const controller = read(SRC, 'modules/storage/storage.controller.ts');
  const block = controller.slice(controller.indexOf('export const S3_PRESETS'), controller.indexOf('] as const;', controller.indexOf('export const S3_PRESETS')));
  const ids = [...block.matchAll(/id: '([A-Z0-9_]+)'/g)].map(m => m[1]);

  // The list is served from the API, so the client must not hardcode its own.
  assert.ok(ids.includes('AWS_S3') && ids.includes('CLOUDFLARE_R2') && ids.includes('OTHER'));
  const form = read(CLIENT, 'pages/storage/CustomS3Form.tsx');
  assert.match(form, /useS3Presets/, 'the form must load presets from the API, not a second hardcoded list');
});
