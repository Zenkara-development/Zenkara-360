# Zenkara 360 (crmitdesk-evolved) — Credentials Audit

_Audit date: 2026-10-31 · Scope: whole project folder (server, client, Android, tests, CI/CD, deploy scripts, docs, `_sync/` archives). No secret values are reproduced in this file._

---

## Status — fresh AWS deployment (2026-10-31)

Decision: go live on a **new AWS Ubuntu server from scratch** — new empty PostgreSQL, new secrets, new GitHub repo, new AI/Google/etc. keys. Nothing from the old server is reused, so the key-rotation steps in §1 and §10 only matter for revoking the leaked keys at their providers.

| Area | Done in code | Still yours to do |
|---|---|---|
| Leaked `.env` archive | `_sync/` and `_to_delete/` deleted | Revoke the old Groq key and R2 token at the providers |
| Secrets (JWT, encryption, share/webhook) | Generated fresh on the server by `deploy/setup-server.sh` (never printed or committed); `'dev-secret'` fallback removed | — |
| Database | Fresh `zenkara_crm` PostgreSQL with a random password, created by `setup-server.sh`; nightly backups to S3 | — |
| Mail | Gmail (`zenkaratech@gmail.com`) defaults everywhere | Gmail App Password → `SMTP_PASS` |
| Google | Client ID wired into builds; root-hosted redirect URIs | Create OAuth client, fill `GOOGLE_*` |
| GitHub / CI/CD | Old AWS account, repo, Render URLs, IP and Netlify proxy (`client/public/_redirects`) removed; everything keyed off `SITE_DOMAIN` | New repo, AWS roles, secrets/variables (`deploy/README.md`) |
| AI, Stripe, Twilio, S3, VAPID | Empty placeholders in the generated `.env` | Create keys on your accounts |

Full go-live steps: [deploy/README.md](deploy/README.md).

---

## 0. Summary (original audit)

| # | Finding | Severity |
|---|---|---|
| 1 | **A real `server/.env` with live-looking secrets is packed inside `_sync/crmitdesk-src.tgz`** (Groq key, R2/S3 keys, encryption key, DB URL) | 🔴 Critical |
| 2 | Previous owner's personal Gmail hardcoded as admin-notify address in `render.yaml` (and in old `_sync` copies of `auth.controller.ts`) | 🟠 High |
| 3 | Previous owner's GitHub repo (`kesava0430/crmitdesk-evolved`) and AWS account `223532249183` wired into CI/CD + IAM trust policy | 🟠 High |
| 4 | Hardcoded weak fallback secret `'dev-secret'` for quote share links | 🟡 Medium |
| 5 | Demo/seed accounts all use password `Admin@123` (seed + ~15 test files) | 🟡 Medium (demo only) |
| 6 | `docker-compose.yml` has hardcoded DB user/password `crmuser` / `crmpass` | 🟡 Medium (local) |
| 7 | Good news: the source code itself has **no** hardcoded API keys/tokens — everything is read from env vars or the encrypted DB columns | ✅ |

> ⚠️ **Typo check:** you wrote `zenkaratech@gmaill.com` (double "l"). The correct address is **`zenkaratech@gmail.com`**.

---

## 1. 🔴 Critical — leaked `.env` inside an archive

**File:** `_sync/crmitdesk-src.tgz` → `./server/.env` (dated 2026-08-16)

| Key | What it holds (masked) | Action |
|---|---|---|
| `DATABASE_URL` | `postgresql://***:***@127.0.0.1:5432/crmitdesk` | Change DB password |
| `GROQ_API_KEY` | `gsk_…` (56 chars — real Groq key format) | **Revoke at console.groq.com** |
| `S3_ENDPOINT` / `S3_BUCKET` | Cloudflare R2, bucket `crmitdesk` | — |
| `S3_ACCESS_KEY_ID` | 32 chars (real R2 format) | **Revoke R2 API token** |
| `S3_SECRET_ACCESS_KEY` | 64 chars (real R2 format) | **Revoke R2 API token** |
| `ENCRYPTION_KEY` | 64-char hex (real) | Rotate (see §9 caveat) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | placeholder text (`your…`) | Set real values |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | `smtp.gmail.com` + placeholders | Replace with your Gmail |

**Do:** delete `_sync/crmitdesk-src.tgz` (and the whole `_sync/`, `_to_delete/` folders if not needed), revoke the Groq + R2 keys, and make sure this archive was never pushed to GitHub (if it was, the keys are compromised regardless).

---

## 2. Where credentials live (3 layers)

1. **Environment variables** — `server/.env` (local/EC2), Render dashboard, `docker-compose` `.env`. Templates: `server/.env.example`, `.env.example`, `render.yaml`.
2. **GitHub repository secrets** — used by `.github/workflows/*.yml`.
3. **Database (encrypted with `ENCRYPTION_KEY`)** — values entered in the app UI (Platform Admin settings, per-org integrations). These override env vars where both exist.

---

## 3. Email (Mail) — replace with `zenkaratech@gmail.com`

| Variable | Read in | Current value / note | New value |
|---|---|---|---|
| `SMTP_HOST` | `server/src/utils/platformSettings.ts:38` | blank / `smtp.gmail.com` | `smtp.gmail.com` |
| `SMTP_PORT` | `platformSettings.ts`, `render.yaml` | `587` | `587` |
| `SMTP_USER` | `platformSettings.ts:40` | blank | `zenkaratech@gmail.com` |
| `SMTP_PASS` | `platformSettings.ts:41` | blank | **Gmail App Password** (16 chars; needs 2-Step Verification on the account — normal Gmail password will NOT work) |
| `SMTP_FROM` | `platformSettings.ts:42` | blank | `Zenkara 360 <zenkaratech@gmail.com>` |
| `RESEND_API_KEY` | `platformSettings.ts:36`, `server/src/utils/mailer.ts` | blank | Optional — see note |
| `RESEND_FROM` | `platformSettings.ts:37` | blank | — |
| `ADMIN_NOTIFY_EMAIL` | `server/src/modules/core/auth/auth.controller.ts:41` | **`render.yaml:84` hardcodes `kesava.harinath30@gmail.com`** | `zenkaratech@gmail.com` |
| `VAPID_SUBJECT` | `server/src/utils/webPush.ts:21` | code fallback `mailto:support@crmitdesk.io` | `mailto:zenkaratech@gmail.com` |
| (hardcoded) | `server/src/utils/mailer.ts:34` | `CRM & IT Desk <onboarding@resend.dev>` default From | Change to your brand |
| (hardcoded) | `_sync/vf/.../auth.controller.ts`, `_sync/em/.../auth.controller.ts` | fallback `kesava.harinath30@gmail.com` | Old copies — delete `_sync/` |
| (example) | `deploy/enable-https.sh`, `deploy/README.md` | `ops@zenkara.in` (Let's Encrypt notices; passed as an argument) | your email |

**DB-stored overrides:** `PlatformSettings.smtpHost/smtpUser/smtpPass/smtpFrom/resendApiKey` (Platform Admin → Platform settings) and per-org `EmailAccount.password` (connected mailboxes). Check/clear these in the UI, because a DB value wins over the env var.

**Notes:**
- Render's free plan **blocks outbound SMTP** — Gmail SMTP only works on EC2/local/paid Render. On Render free you'd need Resend, and Resend can't send *from* a `@gmail.com` address (it requires a domain you own).
- Gmail sending limit is ~500 mails/day.

---

## 4. Database — currently PostgreSQL, you want MySQL

| Location | Current | Change |
|---|---|---|
| `DATABASE_URL` (env; read by Prisma `server/prisma/schema.prisma:7`) | Neon Postgres (prod), `postgresql://…@127.0.0.1:5432/crmitdesk` (local) | `mysql://USER:PASS@HOST:3306/crmitdesk` |
| `server/prisma/schema.prisma:6` | `provider = "postgresql"` | `provider = "mysql"` |
| `server/prisma/migrations/migration_lock.toml` | `provider = "postgresql"` | regenerated |
| `docker-compose.yml:5-20, 34` | `postgres:16-alpine`, user `crmuser` / pass **`crmpass`** (hardcoded) | `mysql:8` service + new creds via `.env` |
| `render.yaml` (top comments + `DATABASE_URL`) | Neon direct URL | MySQL host URL |
| GitHub secret `DATABASE_URL` (`.github/workflows/db-backup.yml`) | Neon URL, uses `pg_dump` | new URL **and** switch to `mysqldump` |
| `deploy/zenkara-pull-deploy.sh:127` | `sudo -u postgres pg_dump … zenkara_crm` | `mysqldump` |
| `server/package.json` | `pg`, `@prisma/adapter-pg` | replace/remove (not imported in `src`) |

**⚠️ Changing to MySQL is NOT just a credential swap** — the code uses PostgreSQL-only features:

| PostgreSQL feature | Count | Where | MySQL fix |
|---|---|---|---|
| Scalar list columns (`String[]` etc.) | 12 | `Subscription.features`, `ApiKey.scopes`, `AttendancePolicyGroup.weeklyOffs`, `Holiday.locationIds`, `TOTPSecret.backupCodes`, `Task.tags`, `ApprovalRequestStep.approverIds`, `KnowledgeDocument.allowedRoleKeys/allowedDepartmentIds`, `KnowledgeChunk.embedding`, `AiModelConfig.taskTypes`, `AiInteractionLog.redactedFields` | Convert to `Json` (Prisma MySQL has no lists) |
| Array filters `has:` | 3 | `server/src/utils/approvals.ts:541`, `server/src/utils/rag.ts:355-356` | Rewrite queries |
| `mode: 'insensitive'` | 35 | across `server/src` | Remove (MySQL collation is case-insensitive by default) |
| pgvector raw SQL | 5 | `server/src/utils/rag.ts:116-161, 415` | Disable pgvector path (in-process fallback exists) |
| Postgres enum query | 1 | `server/scripts/platform-admin.ts:72` (`pg_enum`) | Rewrite |
| 57 migration folders (PG SQL) | 57 | `server/prisma/migrations/` | Regenerate a fresh baseline for MySQL; migrate existing data separately |

I recommend doing the MySQL move as a separate, planned task after the credential rotation.

---

## 5. Google APIs (Sign-In, Drive, Calendar)

One OAuth client covers all three.

| Variable | Read in | Change to |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `server/src/utils/googleAuth.ts:24,32`, `googleDrive.ts:7`, `googleCalendar.ts:22,40,66,96`, `modules/core/auth/auth.controller.ts:629` | New OAuth client from **your** Google Cloud project (log in as zenkaratech@gmail.com) |
| `GOOGLE_CLIENT_SECRET` | `googleDrive.ts:8`, `googleCalendar.ts:22,67,97` | New client secret (`GOCSPX-…`) |
| `VITE_GOOGLE_CLIENT_ID` (client build) | `client/src/shared/components/GoogleSignInButton.tsx:35`, `client/src/pages/LoginPage.tsx:27` | Same as `GOOGLE_CLIENT_ID` |
| `APP_URL` | `server/src/index.ts`, `storage.controller.ts`, `googleCalendar.ts`, `entraAuth.ts`, `mailer.ts` | Your backend URL |

Register these redirect URIs on the new client: `<APP_URL>/api/storage/google/callback`, `<APP_URL>/api/calendar/callback`.
DB-stored: `StorageConfig.accessToken/refreshToken`, `CalendarConnection.accessToken/refreshToken` (user-connected tokens — users must reconnect after client change).
Android: `client/android/app/build.gradle:48` looks for `google-services.json` (not present — only needed for FCM push).

---

## 6. AI providers

| Variable | Read in | Note |
|---|---|---|
| `GROQ_API_KEY` | `server/src/utils/ai.ts:18-20`, `utils/aiGateway.ts:54-58`, `modules/ai/ai.controller.ts:41`, `modules/ai/aiStudio.controller.ts:21-24` | Used first. **Leaked key in `_sync` archive — revoke.** |
| `OPENAI_API_KEY` | `utils/ai.ts:25-30`, `utils/aiGateway.ts:72-80`, `aiStudio.controller.ts:26-27` | Fallback |
| `OPENAI_BASE_URL` | `utils/ai.ts`, `utils/aiGateway.ts` | Optional custom endpoint |
| `AI_MODEL_FAST`, `AI_MODEL_SMART` | same files | Model IDs (not secret) |
| `*_COST_PER_1K`, `AI_REQUEST_TIMEOUT_MS`, `AI_SMART_FEATURES` | `utils/aiGateway.ts` | Not secret |

DB-stored: `AiProvider.apiKeyEncrypted` (per-org BYO keys, set in AI Studio).

---

## 7. GitHub + CI/CD pipelines

### GitHub repository secrets / variables required

| Secret | Workflow | Purpose |
|---|---|---|
| `DATABASE_URL` | `db-backup.yml` | Nightly dump |
| `AWS_DEPLOY_ROLE_ARN` | `deploy.yml` | OIDC role (`arn:aws:iam::223532249183:role/ZenkaraGitHubDeploy`) |
| `DEMO_RESET_SECRET` | `reset-demo.yml` | Must match server env |
| `DIRECTORY_SYNC_SECRET` | `directory-sync.yml` | Must match server env |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | `android.yml` | Play Store signing |
| var `SITE_URL` (optional) | `deploy.yml` | Health-check URL |

### Previous owner's accounts / hardcoded infrastructure

| What | Where | Change |
|---|---|---|
| GitHub repo `kesava0430/crmitdesk-evolved` | IAM trust policy in `deploy/README.md:61`; `Production-Readiness-Report.md:20` | Update trust policy `sub` to `repo:<your-account>/<repo>:*` |
| AWS account `223532249183` | `.github/workflows/deploy.yml:105`, `deploy/README.md:57,77` | Your AWS account / role ARN |
| S3 deploy bucket `zenkara-deploy`, region `eu-north-1` | `deploy.yml:44-46`, `deploy/zenkara-pull-deploy.sh:17` | Your bucket |
| EC2 public IP `13.48.19.159` | `client/capacitor.config.ts:16`, `client/android/app/src/main/res/xml/network_security_config.xml:5,6,21` | Your server IP/domain |
| Domain `app.zenkara.in` | `android.yml:47`, `deploy.yml`, `deploy/enable-https.sh`, `Claude outputs/nginx-app.zenkara.in.conf` | Keep if yours |
| Render URL `crm-itdesk-server.onrender.com` | `keep-alive.yml`, `reset-demo.yml`, `directory-sync.yml`, `render.yaml` (APP_URL + rewrite), `bootstrap-platform-admin.ps1` | Your backend URL |
| EC2 `git fetch origin` | `deploy/zenkara-pull-deploy.sh:84` | The instance's git remote/credentials (on the server, not in repo) must point to your repo |

No GitHub PATs, SSH keys or `ghp_` tokens were found in the code.

---

## 8. Other credentials (app/integration modules)

| Area | Variables | Read in | DB-stored equivalent |
|---|---|---|---|
| **Auth / sessions** | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN` | `middleware/authenticate.ts:54`, `authenticatePortal.ts:13`, `auth.controller.ts:94,684,702`, `calendar.controller.ts:37,49`, `events.routes.ts:15`, `portal.controller.ts:93`, `storage.controller.ts:125,148` | — |
| **Encryption at rest** | `ENCRYPTION_KEY` | `server/src/utils/crypto.ts:31` | encrypts all DB secrets below |
| **Hosted storage (S3/R2)** | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT` | `utils/platformSettings.ts:84+` | `PlatformSettings.s3*`, per-org `StorageConfig.s3SecretAccessKey` |
| **Billing (Stripe)** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` | `utils/stripe.ts:8` | — |
| **WhatsApp (Twilio)** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | `utils/platformSettings.ts:56`, `modules/inbox/inbox.controller.ts:414` | `PlatformSettings.twilio*`, per-org `WhatsAppConfig.accountSid/authToken` |
| **Web push** | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `utils/webPush.ts:20-25` | — |
| **Microsoft Entra ID SSO** | (no env — per org) | `utils/entraAuth.ts` | `DirectoryConfig.clientSecretEnc` |
| **Shared endpoint secrets** | `QUOTE_SHARE_SECRET`, `WORKFLOW_WEBHOOK_SECRET`, `DIRECTORY_SYNC_SECRET`, `DEMO_RESET_SECRET`, `PLATFORM_BOOTSTRAP_SECRET` | `quotes.controller.ts:131`, `invoices.controller.ts:157`, `utils/workflow-engine.ts:68,90`, `directory.controller.ts:227`, `demo.controller.ts:22,175`, `platformAdmin.controller.ts:44` | Webhook signing secrets per workflow (`secret` column) |
| **2FA** | — | — | `TOTPSecret.secret` (per user) |
| **Platform admin bootstrap** | `PLATFORM_BOOTSTRAP_SECRET`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` (session env only) | `bootstrap-platform-admin.ps1` | `User.passwordHash` |

**Hardcoded fallback:** `server/src/modules/quotes/quotes.controller.ts:131` falls back to the literal `'dev-secret'` if both `QUOTE_SHARE_SECRET` and `JWT_SECRET` are unset — should throw instead.

---

## 9. Demo / test credentials (not production, but worth knowing)

| What | Where |
|---|---|
| Seeded demo users `admin@ / crm@ / sales@ / itmanager@ / itagent@crmitdesk.com`, all password **`Admin@123`** | `server/src/utils/seedDemoData.ts:886-893, 1105` |
| Same logins | `tests/e2e/*.spec.ts` (rbac, rbac-ui, role-login, security, pagination, refresh-token), `tests/helpers/auth.ts:6`, `tests/helpers/seed-admin.ts`, `tests/global-setup.ts`, `server/tests/**` |
| Other test passwords: `AlicePass@123`, `BobPass@123`, `Playwright@123`, `TestUser@123` | `tests/e2e/multitenancy.spec.ts`, `user-management.spec.ts`, `tests/helpers/seed.ts` |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `DEMO_LOGIN_EMAIL` | env overrides for tests/demo |
| Placeholder `you@gmail.com` | `client/src/modules/inbox/InboxPage.tsx` (UI placeholder only) |

If you rebrand the demo, change the seed emails/password and the test files together, or the tests break.

---

## 10. Recommended rotation order + caveats

1. **Revoke leaked keys now:** Groq key, Cloudflare R2 token; delete `_sync/crmitdesk-src.tgz`.
2. Create your own accounts/keys: Google Cloud OAuth client, Groq/OpenAI, R2/S3, Stripe, Twilio, VAPID (`npx web-push generate-vapid-keys`), Gmail App Password.
3. Generate new random secrets (`openssl rand -hex 64`): `JWT_SECRET`, `JWT_REFRESH_SECRET`, `QUOTE_SHARE_SECRET`, `WORKFLOW_WEBHOOK_SECRET`, `DIRECTORY_SYNC_SECRET`, `DEMO_RESET_SECRET`, `PLATFORM_BOOTSTRAP_SECRET`.
4. Update `server/.env` / Render / EC2, then the matching GitHub secrets.
5. Edit the hardcoded spots: `render.yaml:84`, `webPush.ts:21`, `mailer.ts:34`, `quotes.controller.ts:131`, `docker-compose.yml`, CI URLs, Capacitor IP, AWS ARN/bucket.
6. MySQL migration as its own task (§4).

**Caveats:**
- **`ENCRYPTION_KEY`**: every encrypted DB value (mailbox passwords, Twilio/Resend/SMTP/S3 secrets, Entra client secrets, AI provider keys, OAuth tokens, employee bank/tax fields) is encrypted with it. Changing it makes them undecryptable — re-enter those values after rotating, or re-encrypt with a migration script.
- **`JWT_SECRET`** change logs everyone out and invalidates outstanding quote/invoice share links (unless `QUOTE_SHARE_SECRET` is set separately).
- **Google client change** — users must reconnect Drive/Calendar.
