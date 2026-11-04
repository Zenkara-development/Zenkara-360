/**
 * Proves an S3-compatible bucket works, from a terminal, before it is wired
 * into anything.
 *
 *     npm run check:storage
 *
 * Reads credentials from the environment (or a .env file, same as the server)
 * and round-trips a probe object: write, read back, delete. Prints which of the
 * three failed and why.
 *
 * Worth having as a separate script rather than only a button in the UI:
 *
 *  - It runs before the app is deployed, so a bucket can be verified while the
 *    Cloudflare/AWS console is still open, not after a redeploy.
 *  - It needs no database, so it works on a fresh clone.
 *  - It exits non-zero on failure, so CI or a deploy script can gate on it.
 *
 * Pass --custom to check a customer-style bucket from a different set of
 * variables, so you can test one before asking a customer to enter it:
 *
 *     CUSTOM_S3_BUCKET=... CUSTOM_S3_ENDPOINT=... \
 *     CUSTOM_S3_ACCESS_KEY_ID=... CUSTOM_S3_SECRET_ACCESS_KEY=... \
 *     npm run check:storage -- --custom
 */
import dotenv from 'dotenv';
import { testConnection, type S3Target } from '../src/utils/s3Storage';

dotenv.config();

const custom = process.argv.includes('--custom');
const P = custom ? 'CUSTOM_S3_' : 'S3_';

function env(suffix: string): string | undefined {
  const v = process.env[`${P}${suffix}`];
  return v && v.trim() ? v.trim() : undefined;
}

const bucket = env('BUCKET');
const accessKeyId = env('ACCESS_KEY_ID');
const secretAccessKey = env('SECRET_ACCESS_KEY');
const endpoint = env('ENDPOINT');
const region = env('REGION') ?? 'auto';
const prefix = env('PREFIX');

const missing = [
  !bucket && `${P}BUCKET`,
  !accessKeyId && `${P}ACCESS_KEY_ID`,
  !secretAccessKey && `${P}SECRET_ACCESS_KEY`,
].filter(Boolean);

if (missing.length) {
  const present = ['BUCKET', 'REGION', 'ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']
    .filter(k => env(k)).map(k => `${P}${k}`);

  console.error(`\n  Missing: ${missing.join(', ')}`);
  if (present.length) console.error(`  Found:   ${present.join(', ')}`);

  console.error(`\n  The reliable fix is to put them in server/.env (already gitignored):\n`);
  for (const k of missing) console.error(`      ${k}=your-value-here`);

  // Reading nothing at all on Windows is almost always this, and the failure
  // is silent: PowerShell aliases `set` to Set-Variable, so `set FOO=bar`
  // creates a PowerShell variable that no child process can see. It looks
  // like it worked.
  if (process.platform === 'win32' && present.length === 0) {
    console.error(`\n  If you used \`set NAME=value\` in PowerShell, that is why nothing was`);
    console.error(`  picked up — PowerShell's \`set\` is Set-Variable and does not touch the`);
    console.error(`  environment. PowerShell needs:   $env:${P}BUCKET = "your-value"`);
    console.error(`  \`set\` only behaves that way in cmd.exe.`);
  }
  console.error('');
  process.exit(2);
}

const target: S3Target = {
  bucket: bucket!,
  region,
  endpoint: endpoint ?? null,
  accessKeyId: accessKeyId!,
  secretAccessKey: secretAccessKey!,
  // Path-style for every non-AWS gateway. Matches what the app does when an
  // endpoint is set, so this script tests the same request shape the server
  // will actually send — a check that passes here and fails there would be
  // worse than no check.
  forcePathStyle: !!endpoint,
  prefix: prefix ?? null,
};

/** Never print a secret, even partially — this output gets pasted into chats. */
function describe(): void {
  console.log(`\n  Bucket    ${target.bucket}${target.prefix ? `/${target.prefix.replace(/\/$/, '')}` : ''}`);
  console.log(`  Region    ${target.region}`);
  console.log(`  Endpoint  ${target.endpoint ?? '(none — Amazon S3)'}`);
  console.log(`  Key ID    ${'•'.repeat(8)} (${accessKeyId!.length} chars)`);
  console.log(`  Style     ${target.forcePathStyle ? 'path' : 'virtual-host'}\n`);
}

async function main() {
  console.log(`\n  Checking ${custom ? 'a customer-style' : 'the platform'} bucket…`);
  describe();

  const started = Date.now();
  const result = await testConnection(target);
  const ms = Date.now() - started;

  if (result.ok) {
    console.log(`  ✓ write   ok`);
    console.log(`  ✓ read    ok`);
    console.log(`  ✓ delete  ok`);
    console.log(`\n  All three succeeded in ${ms}ms. This bucket is ready to use.\n`);
    process.exit(0);
  }

  const order = ['write', 'read', 'delete'] as const;
  const failedAt = order.indexOf(result.step ?? 'write');
  for (let i = 0; i < order.length; i++) {
    if (i < failedAt) console.log(`  ✓ ${order[i].padEnd(7)} ok`);
    else if (i === failedAt) console.log(`  ✗ ${order[i].padEnd(7)} FAILED`);
    else console.log(`  · ${order[i].padEnd(7)} not attempted`);
  }

  console.log(`\n  ${result.error}\n`);

  // The three failures map to three specific IAM statements — but only print
  // that hint when the failure actually WAS a permission problem. Telling
  // someone to fix an IAM policy when their endpoint URL is wrong sends them
  // to rewrite something that was already correct.
  const permissionRelated = /not allowed|s3:[A-Za-z]/.test(result.error ?? '');
  const hint: Record<string, string> = {
    write: 'The key needs s3:PutObject on this bucket. On AWS, also check the policy Resource ends in /* — arn:aws:s3:::bucket denies object actions; arn:aws:s3:::bucket/* allows them.',
    read: 'The key needs s3:GetObject. Uploads would work and files would never open.',
    delete: 'The key needs s3:DeleteObject. Deleting an attachment would remove the row and leave the file, billed to you forever.',
  };
  if (result.step && permissionRelated) console.log(`  ${hint[result.step]}\n`);

  process.exit(1);
}

main().catch(err => {
  console.error('\n  Unexpected failure:', err?.message ?? err, '\n');
  process.exit(1);
});
