/**
 * Fail-fast environment validation, run once at boot (index.ts, right after
 * dotenv.config()).
 *
 * Why: without this, the server boots "healthy" (the /health probe only
 * checks the database) with no JWT_SECRET configured — and then every single
 * login 500s at runtime. Worse, some code paths used to degrade silently
 * instead of failing (share links falling back to a hardcoded secret, CORS
 * falling back to localhost in production). Refusing to start with a clear
 * message turns all of those into a deploy-time error the operator sees
 * immediately, instead of a security hole or a mystery outage.
 */

/** Required in every environment — the app cannot function without these. */
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'] as const;

/**
 * Additionally required in production. Each of these has a localhost-flavored
 * fallback somewhere in the code that is actively wrong in prod:
 * CORS_ORIGIN falls back to http://localhost:5173 (browsers get CORS-blocked),
 * FRONTEND_URL is baked into invite/reset/share links sent to customers,
 * APP_URL is used for OAuth redirect URIs and survey links.
 */
const PROD_REQUIRED = ['CORS_ORIGIN', 'FRONTEND_URL', 'APP_URL'] as const;

/** Known weak placeholder values that must never survive into production. */
const PLACEHOLDER_VALUES = new Set([
  'your-super-secret-jwt-key-change-in-production',
  'your-refresh-secret-change-in-production',
  'change-me',
  'changeme',
  'secret',
  'dev-secret',
]);

export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const problems: string[] = [];

  for (const key of REQUIRED) {
    if (!process.env[key]) problems.push(`${key} is not set`);
  }

  if (isProd) {
    for (const key of PROD_REQUIRED) {
      if (!process.env[key]) problems.push(`${key} is not set (required in production)`);
    }
    for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY'] as const) {
      const value = process.env[key];
      if (value && (PLACEHOLDER_VALUES.has(value) || value.length < 16)) {
        problems.push(`${key} looks like a placeholder or is too short (< 16 chars) — set a long random value`);
      }
    }
  }

  if (problems.length > 0) {
    console.error('FATAL: refusing to start — environment misconfigured:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      'Set these in the Render dashboard (or your .env for local dev). ' +
      'See .env.example and render.yaml for what each one does.',
    );
    process.exit(1);
  }
}
