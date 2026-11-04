/**
 * Inspects — and if asked, creates or repairs — the cross-org PLATFORM_ADMIN
 * login used by the /platform-admin licensing console.
 *
 *     npm run platform:admin                                   # diagnose only
 *     npm run platform:admin -- --email you@x.com --password 'secret' --name You
 *
 * Why this exists alongside bootstrap-platform-admin.ps1:
 *
 * That script talks HTTP to a *running* server (POST /api/platform/bootstrap)
 * and needs PLATFORM_BOOTSTRAP_SECRET to be set in that server's environment,
 * or the endpoint deliberately 404s. Two things go wrong with it in practice:
 *
 *  1. Its $ServerUrl points at the deployed Render instance, so it creates the
 *     account in the *hosted* database. If you then try to sign in against a
 *     local server (DATABASE_URL=...127.0.0.1:5432/crmitdesk), that account
 *     simply is not there, and login correctly answers "Invalid credentials".
 *  2. If PLATFORM_BOOTSTRAP_SECRET was never set on the target server, the
 *     request 404s and no account is ever created — the script reports the
 *     failure, but it is easy to miss.
 *
 * This script sidesteps both: it writes through Prisma using the same
 * DATABASE_URL the server itself loads, so whatever database the app reads is
 * exactly the one it touches. No secret, no running server, no HTTP.
 *
 * A PLATFORM_ADMIN is deliberately NOT a member of any organization — it has
 * orgId = null (User.orgId is nullable for exactly this reason). It is not a
 * "super org"; it is an org-less operator account. The client routes it
 * straight to /platform-admin and never renders the normal org-scoped shell,
 * because every page in that shell assumes an org (see ProtectedRoute in
 * client/src/App.tsx).
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

/** postgresql://user:pass@host:5432/db -> user@host:5432/db (never prints the password). */
function describeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return '(DATABASE_URL is not set)';
  try {
    const u = new URL(raw);
    return `${u.username}@${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(DATABASE_URL is set but could not be parsed)';
  }
}

async function main() {
  const email = arg('email');
  const password = arg('password');
  const name = arg('name') ?? 'Platform Admin';

  console.log('\nDatabase   :', describeDatabaseUrl(process.env.DATABASE_URL));
  console.log('Bootstrap  :', process.env.PLATFORM_BOOTSTRAP_SECRET
    ? 'PLATFORM_BOOTSTRAP_SECRET is set (POST /api/platform/bootstrap is enabled)'
    : 'PLATFORM_BOOTSTRAP_SECRET is NOT set (POST /api/platform/bootstrap returns 404)');

  // Does the database even know the role? If a deployment is behind on
  // migrations, 20260804000000_platform_admin_role may not have run, and any
  // attempt to write the role fails with "invalid input value for enum".
  const roleValues = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'UserRole'`,
  );
  const knowsRole = roleValues.some(r => r.enumlabel === 'PLATFORM_ADMIN');
  console.log('Role enum  :', knowsRole
    ? "database knows 'PLATFORM_ADMIN'"
    : "database does NOT know 'PLATFORM_ADMIN' — run `npx prisma migrate deploy` first");

  const existing = await prisma.user.findMany({
    where: { role: 'PLATFORM_ADMIN' },
    select: { id: true, email: true, name: true, isActive: true, orgId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\nPlatform admin accounts in THIS database: ${existing.length}`);
  for (const u of existing) {
    const problems: string[] = [];
    if (!u.isActive) problems.push('INACTIVE — login is refused before the password is even checked');
    if (u.orgId) problems.push(`orgId is set (${u.orgId}) — should be null for a cross-org operator`);
    console.log(`  • ${u.email}  (${u.name})  created ${u.createdAt.toISOString().slice(0, 10)}`);
    if (problems.length) problems.forEach(p => console.log(`      ! ${p}`));
  }
  if (!existing.length) {
    console.log('  (none — this is why signing in returns "Invalid email or password")');
  }

  if (!email || !password) {
    console.log(
      '\nTo create or reset one, re-run with credentials:\n' +
      "  npm run platform:admin -- --email you@example.com --password 'your-password' --name 'Your Name'\n",
    );
    return;
  }

  if (!knowsRole) {
    console.error('\nRefusing to write: this database has no PLATFORM_ADMIN role yet.');
    console.error('Run `npx prisma migrate deploy` in the server directory, then re-run this.\n');
    process.exitCode = 1;
    return;
  }

  if (password.length < 8) {
    console.error('\nPassword must be at least 8 characters.\n');
    process.exitCode = 1;
    return;
  }

  // Upsert by email, exactly like the bootstrap endpoint, so re-running this
  // resets the password of an existing operator rather than failing on the
  // unique-email constraint or creating a second account.
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'PLATFORM_ADMIN', orgId: null, passwordHash, isActive: true },
    create: { email, name, passwordHash, role: 'PLATFORM_ADMIN', orgId: null },
  });

  // A TOTP secret left over from a previous life as a normal org user would
  // silently turn login into a 2FA challenge. Report it rather than deleting
  // it — removing someone's second factor should be a deliberate act.
  const totp = await prisma.tOTPSecret.findUnique({
    where: { userId: user.id },
    select: { enabled: true },
  });

  console.log(`\n✓ Platform admin ready: ${user.email}`);
  console.log('  Sign in at your normal login page — you will land on /platform-admin.');
  if (totp?.enabled) {
    console.log('  NOTE: this account has 2FA enabled, so login will also ask for your authenticator code.');
  }
  console.log();
}

main()
  .catch(e => { console.error('\nFailed:', e instanceof Error ? e.message : e, '\n'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
