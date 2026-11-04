# CRMITdesk Evolved — Production Readiness Report

**Date:** 20 August 2026
**Scope:** Full audit of the codebase at `C:\Projects\CRMITDesk` — security & multi-tenancy, reliability & deployment (Render), build/test health, dependency vulnerabilities, and client/PWA readiness. Findings were cross-verified against the source code; file and line references are included so each item can be located quickly.

---

## Verdict: **NOT ready yet — but close.**

The foundation is much stronger than a typical early-stage product: tenant isolation is solid (no IDOR found across all sampled modules), passwords and tokens are handled correctly, uploads are locked down, both server and client build cleanly with zero TypeScript errors, and 189/190 unit tests pass. This is genuinely good engineering.

However, there are **2 critical security exposures that are live right now**, plus a set of high-severity issues that will cause real customer-facing failures (billing webhooks broken, data-loss migration, duplicate email sends on deploys, free-tier database with no backups). Estimate: **roughly 3–7 focused days** to clear the blockers below, after which a limited customer launch is reasonable.

---

## 🔴 CRITICAL — fix before anything else (both verified live)

### 1. Production platform-admin secret is public on GitHub
- `bootstrap-platform-admin.ps1` (lines 19–22) contains the **real** `PLATFORM_BOOTSTRAP_SECRET`, an email, and a password, pointed at the live server `https://crm-itdesk-server.onrender.com`.
- The file **is committed to git** (commit `a1c7b2e`) and the repo `github.com/kesava0430/crmitdesk-evolved` **is publicly accessible** — I verified this from outside.
- `POST /api/platform/bootstrap` requires no login — only this secret header — and creates/resets a `PLATFORM_ADMIN`, a cross-org role that can read and modify **every tenant's** data, subscriptions, and branding.
- **Fix now:** (a) unset/rotate `PLATFORM_BOOTSTRAP_SECRET` on Render (unset → endpoint 404s), (b) reset the `kesava@quantiqsystems.com` password, (c) make the repo private or scrub the file from history (e.g. `git filter-repo` / BFG), (d) audit for any unexpected PLATFORM_ADMIN accounts or logins.

### 2. Real infrastructure credentials sitting in `server/.env`
- `server/.env` contains live-looking **Cloudflare R2 access + secret keys** (read/write to all tenant attachments), a **Groq API key**, a DB password, and the `ENCRYPTION_KEY` used to decrypt stored mailbox/OAuth secrets.
- The file is gitignored (good — `git ls-files` confirms it is not committed), but it travels with every copy/zip/backup of the project folder. Given the repo is public, treat everything in it as at-risk.
- **Fix:** rotate the R2 key pair, Groq key, DB password, and `ENCRYPTION_KEY` (note: rotating `ENCRYPTION_KEY` requires re-encrypting stored secrets — plan the migration). Never include real values in `.env` files that live in the project tree; keep them only in Render's dashboard / a secrets manager.

---

## 🟠 HIGH — customer-facing breakage or serious risk (fix before launch)

### 3. Privilege escalation: managers can make themselves SUPER_ADMIN
`server/src/modules/core/users/usersAdmin.controller.ts` (update handler, ~lines 194–234): the route allows `IT_MANAGER`/`CRM_MANAGER`, and the update schema accepts the full role enum including `SUPER_ADMIN`, with no check that the caller outranks the assigned role or isn't editing themselves. A manager can `PATCH /api/admin/users/:id` with `{"role":"SUPER_ADMIN"}` on their own account.
**Fix:** only SUPER_ADMIN may change roles; forbid assigning a role ≥ your own; forbid changing your own role.

### 4. Stripe webhooks are broken (billing events silently dropped)
`server/src/index.ts:127` mounts `express.json()` globally **before** the billing router (`:257`), so the raw body the webhook route needs (`billing.routes.ts:8`) is already consumed. Signature verification (`utils/stripe.ts:100`) can never match → all real Stripe events fail → plan upgrades/downgrades never apply. Related: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and price-ID env vars are **absent from render.yaml**, so billing is doubly non-functional on the current deployment.
**Fix:** mount the webhook with `express.raw()` before the global JSON parser (or exclude its path), and add the Stripe env vars (`sync: false`) to render.yaml.

### 5. Free-tier database with no backups + destructive migration
- `render.yaml` lines 5 & 13: both DB and web service are `plan: free`. **Render free Postgres expires after ~30 days and has no backups** — that alone is disqualifying for paying customers. Free web services also spin down after ~15 min idle, which stops all your background pollers (email sync, SLA monitor, reminders, retries) while asleep.
- Migration `20260816102318_tagfihing` **drops `contact_tags` and `deal_tags`**; the data-preserving backfill lives only in a manual script (`prisma/backfill-record-tags.sql`) that `prisma migrate deploy` never runs. That script also says the project historically used `db push` — if so, the first `migrate deploy` against the existing prod DB will fail with P3005 until you baseline it (`prisma migrate resolve`).
- **Fix:** paid plans for web + Postgres, enable backups, fold the backfill INSERT…SELECT into the migration before the DROPs, and baseline the prod DB.

### 6. IMAP certificate verification disabled in production
`server/src/utils/email-sync.ts:59` — `tls: { rejectUnauthorized: false }` runs unconditionally. Every tenant mailbox password is sent over a connection that accepts any certificate (MITM can harvest credentials).
**Fix:** gate on `NODE_ENV !== 'production'` or make it a per-account opt-in.

### 7. Duplicate customer emails/messages on every deploy; not multi-instance safe
`utils/jobQueue.ts` claims jobs with a non-atomic find-then-update, and its boot-time recovery re-queues everything `PROCESSING`. Render's zero-downtime deploys run old + new instances **concurrently** → duplicated sends even at one instance. Email sync dedupe (`email-sync.ts:88`) has no unique constraint behind it and — worse — is **not org-scoped**: the same Message-ID arriving at two different tenants is stored for only one of them (`Message.externalId` has no index either, so dedupe is also a growing full-table scan).
**Fix:** atomic claim (`updateMany where status='PENDING'` or `FOR UPDATE SKIP LOCKED`), time-based stall detection instead of boot sweep, advisory lock around pollers, and a per-account unique constraint like `@@unique([emailAccountId, externalId])`.

### 8. Hardcoded `'dev-secret'` fallback on public quote/invoice links
`quotes.controller.ts:129` and `invoices.controller.ts:140`: `QUOTE_SHARE_SECRET || JWT_SECRET || 'dev-secret'`. Any deployment missing both env vars signs public e-signature links with a known constant → anyone can forge access to any quote/invoice. Also: there is **no startup env validation** anywhere — the server boots "healthy" with no `JWT_SECRET` and then 500s every login.
**Fix:** remove the literal; validate required env (JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL, CORS_ORIGIN, …) with Zod at startup and exit if missing.

### 9. Server dependency vulnerabilities: 6 high (production deps)
`npm audit --omit=dev`: **nodemailer 6.x** (SMTP command injection, CRLF header injection, arbitrary file read/SSRF via `raw` — fix is v9, a major bump), the **ip-address SSRF cluster**, mailparser chain DoS. `multer 1.x` is deprecated/EOL (upgrade to 2.x). Client runtime: react-router open-redirect (non-breaking fix available).
**Fix:** upgrade nodemailer (test email sending paths), `npm audit fix` the rest, bump multer to 2.x.

### 10. nginx config breaks API responses + stale-deploy white screens (Docker path)
`client/nginx.conf`: the regex asset location (line 27) takes precedence over `location /api/`, so any API URL ending in `.png/.js/.css/...` (avatars, attachments) is served as a static 404 instead of proxied. And `index.html` is served with no `Cache-Control: no-cache`, so browsers cache it and reference purged hashed chunks after deploys → white screen. No security headers (CSP, X-Frame-Options, nosniff) at all.
**Fix:** `location ^~ /api/ { ... proxy_buffering off; proxy_read_timeout 24h; }`, `location = /index.html { add_header Cache-Control "no-cache"; }`, add the standard security-header set. (If you launch on Render static hosting only, this is lower priority — but the missing security headers still apply there via `headers:` in render.yaml.)

---

## 🟡 MEDIUM — should fix soon after (first 2–4 weeks)

1. **No crash safety net / observability** — zero `unhandledRejection`/`uncaughtException` handlers (Node 20 kills the process on unhandled rejections); logging is 72 raw `console.*` calls; no Sentry/pino, no request logging. You will be blind to production incidents. Add handlers + structured logging + error tracking.
2. **SSRF via admin-configured URLs** — workflow webhooks (`workflow-engine.ts:105`) and custom-module sync (`customModuleSync.ts:33`) fetch arbitrary admin-supplied URLs with no private-IP/metadata-range blocking. Block loopback/link-local/RFC1918/169.254.169.254, require https.
3. **JWTs in localStorage** (`client/src/api/client.ts:14`, `AuthContext.tsx`) — any XSS = 7-day session theft in a multi-tenant CRM. Mitigate with a CSP now; longer-term move refresh token to an httpOnly cookie. Related: access token in SSE query string (`useSSE.ts:41`) ends up in proxy logs.
4. **Email-sync poller has no overlap guard or socket timeout** — one hung IMAP server → concurrent overlapping syncs → duplicates/connection pile-up.
5. **Graceful shutdown never completes with SSE clients connected** — always hits the 10s force-kill; end SSE responses and clear intervals on SIGTERM.
6. **CORS falls back to localhost in prod** if `CORS_ORIGIN` is forgotten (`index.ts:120`) — fail fast instead (covered by env validation in #8).
7. **Failing unit test** — 189/190; `storage-providers.test.ts:196` asserts a stale pattern (`s3Bucket: z.string()` vs. refactored `optionalText()`). Fix the assertion so the suite can gate CI.
8. **No CI at all** — `.github/workflows` has only ops crons (demo reset, directory sync). Nothing builds, typechecks, tests, or audits on push. Add a workflow: `npm ci` (root — it's a workspaces monorepo; per-folder `npm ci` wipes the shared tree), `prisma generate` → `tsc`, unit tests, `npm audit`. The 57 Playwright specs aren't CI-runnable yet (webServer commented out, live-DB global-setup) — worth wiring up.
9. **Client Dockerfile has no `.dockerignore`** with `COPY . .` (server has one). Add `node_modules`, `dist`, `.env*`.
10. **Dead-but-dangerous code** — `client/src/utils/scriptEngine.ts` is an escapable `new Function` sandbox (can reach localStorage tokens). Currently unimported; delete it before someone wires it up.
11. **No top-level error boundary** — a crash in Login/Portal/layout chrome = blank white screen (`main.tsx`); wrap `<App/>`.
12. **Personal Gmail hardcoded** as signup-approval destination in `render.yaml:80` **and** as a code fallback (`auth.controller.ts:38`).
13. **Non-timing-safe secret comparisons** on cron/demo/directory endpoints (`provided === secret`) — use `crypto.timingSafeEqual`.
14. **Service-worker API bypass regex is fragile** (`sw.ts:25` matches `/^\/api\//` against full URLs) — fine today with same-origin `/api`, breaks silently if you ever set an absolute `VITE_API_URL`. Use a pathname matcher. Also add an offline navigation fallback route.

## 🟢 LOW / hygiene

Repo clutter that ships in the tree (42 `.bak` files under `client/src`, `auth.controller.ts.bak`, duplicate `playwright.config.js`/`.ts`, `results.txt`/`resultnew.txt`, `~$*.docx` lock files, stale per-workspace lockfiles) — most are gitignored but still confuse builds and reviews; delete them. `JWT_REFRESH_SECRET` env var is configured but never read (dead config). `keepAliveTimeout` not tuned behind Render's proxy (intermittent 502s at load). Prisma logs errors only. Expiry toast is destroyed by the redirect before users see it; `localStorage.clear()` on logout wipes theme prefs. Self-host Google Fonts for true offline PWA.

---

## ✅ What's already in good shape (verified)

Tenant isolation held up across every sampled module — tickets, deals, leads, contacts, accounts, quotes, invoices, custom modules, attachments — all org-scoped, no IDOR found. Password hashing (bcrypt-12), reset flows (hashed single-use tokens, enumeration-safe), and refresh-token rotation (hashed, revoked on password change) are textbook. Uploads are memory-only with size/type limits and filename sanitization straight to S3/Drive — no ephemeral-disk data loss. Raw SQL is fully parameterized; no command execution anywhere. Helmet, single-origin CORS, body limits, and rate limits on all auth endpoints are in place, with `trust proxy` set correctly for Render. Secrets at rest are AES-256-GCM encrypted; render.yaml itself commits no secrets (uses `generateValue`/`sync:false`). Both builds compile with **zero** TypeScript errors; the client ships a proper PWA with correct update semantics (autoUpdate + skipWaiting) and API responses excluded from caching; error-toast UX on the client is thoughtful. Migrations are committed (40) and `migrate deploy` runs on start. The server Dockerfile is multi-stage, non-root, with a `.dockerignore`.

---

## Suggested launch sequence

**Day 1 (today):** rotate/unset `PLATFORM_BOOTSTRAP_SECRET`, reset the exposed password, make the repo private, rotate R2/Groq/DB/ENCRYPTION_KEY credentials, audit for unauthorized platform admins.
**Days 2–4:** fix privilege escalation (#3), Stripe webhook order + env vars (#4), `rejectUnauthorized` (#6), `'dev-secret'` fallback + startup env validation (#8), fold tag backfill into the migration and baseline prod DB (#5), upgrade to paid Render plans with DB backups (#5), nginx fixes if using the Docker path (#10).
**Days 5–7:** dependency upgrades (nodemailer 9, multer 2, audit fixes) (#9), job-queue atomic claiming + email-sync unique constraint (#7), crash handlers + Sentry, fix the failing unit test, add a minimal CI workflow.
**Then:** limited launch with a handful of customers while you work through the medium list (CSP/token storage, SSRF guards, poller hardening, e2e in CI).

*One process note: full end-to-end runtime testing (login flows, Stripe test events, email round-trips) against a staging deployment wasn't possible from this audit environment — the findings above are from code-level verification, builds, and unit tests. A staging smoke-test pass after the Day 2–4 fixes is strongly recommended.*
