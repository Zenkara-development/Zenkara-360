# Entra ID SSO — Testing Steps, Phases 1-3 (Netlify frontend + Render backend)

Before moving on to phases 2-3 (auto-provisioning, group-to-role mapping), this walks through verifying phase 1 — SSO login for existing users — end to end, for your actual deployment: **frontend on Netlify, backend on Render**. This can't be tested in a sandbox without network access, so it has to run against your real deployed URLs.

A note on `render.yaml`: it defines *two* Render services — the API (`crm-itdesk-server`) and a static-site frontend (`crm-itdesk-client`) that proxies `/api/*` to the API. Since your frontend actually lives on Netlify instead, that second service either isn't the one you're using or is sitting unused — either way, the steps below treat Netlify as the real frontend and adjust the pieces that assumption changes (mainly `VITE_API_URL` and CORS).

---

## 0. Environment variables — where each one actually needs to be set

**On Render (backend service → Environment tab):**

| Variable | Value | Notes |
|---|---|---|
| `APP_URL` | `https://crm-itdesk-server.onrender.com` (or your service's actual `.onrender.com` URL) | Already set per `render.yaml`. This is what builds the Entra redirect URI — register `<APP_URL>/api/auth/entra/callback` in Entra, not anything Netlify-related. |
| `FRONTEND_URL` | `https://<your-site>.netlify.app` (or custom domain) | `render.yaml` has this as `sync: false` — set it manually in Render's dashboard. This is where the login-error and `/sso-callback` redirects go, so if it's still `http://localhost:5173` or unset, the OAuth flow will bounce the browser to the wrong place after Microsoft. |
| `CORS_ORIGIN` | Same Netlify URL as `FRONTEND_URL` | Also `sync: false`. **This matters more than usual for this feature** — after Microsoft redirects back to `/sso-callback`, that page calls `GET /auth/me` via axios (a real cross-origin XHR from Netlify to Render), and that call will be blocked by the browser if this doesn't exactly match your Netlify origin. The two full-page redirects (`/login/:slug` and the Microsoft round trip) aren't affected by CORS — only that one `/auth/me` fetch is, but it's the one that actually finishes the login. |
| `ENCRYPTION_KEY` | (already auto-generated) | `render.yaml` has `generateValue: true` — nothing to do here unless you rotated it manually. |
| `JWT_SECRET` | (already set) | Unchanged, just confirming it's the same value your existing sessions rely on. |

**On Netlify (Site settings → Environment variables):**

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_URL` | `https://crm-itdesk-server.onrender.com/api` | **Check this one specifically.** There's no `netlify.toml` in this repo proxying `/api/*` the way the Render static site does — if `VITE_API_URL` is set to just `/api` (the value `render.yaml` uses for the *Render-hosted* frontend), the client will try to hit `https://<your-netlify-site>/api/...` and 404, since Netlify has nothing listening there. It needs to be the full Render URL. This affects the whole app, not just SSO, so if login/everything else already works from Netlify today, this is almost certainly already correct — just confirm it explicitly since the new `EntraLoginPage.tsx` builds its redirect URL from this same variable. |

After confirming/updating any of these: **redeploy both services** (Render env var changes require a redeploy or manual restart to take effect; Netlify env var changes require a new deploy/build, not just a redeploy of the existing build).

Then, against the Render backend:

1. Run the migration — either let `render.yaml`'s `startCommand` do it automatically (`npx prisma migrate deploy && node dist/index.js`, which runs on every deploy), or trigger a manual deploy so it picks up the new `20260812110000_entra_sso` migration.
2. Confirm the deploy log shows the migration applying cleanly and `tsc`/the build succeeding (you've already hit and fixed one build error here — worth a clean look at the full log once more).

---

## 1. Create a test app registration in Entra ID

Do this in the Azure/Entra portal, in a tenant you control for testing (not a production customer tenant).

1. **Microsoft Entra ID → App registrations → New registration.** Name it something like "CRMITdesk SSO (test)". Leave "Supported account types" as single-tenant for a first test.
2. Skip the redirect URI for now — you'll get the exact value from CRMITdesk's admin page in step 2 and add it after.
3. From the app's **Overview** page, copy the **Application (client) ID** and **Directory (tenant) ID**.
4. **Certificates & secrets → New client secret.** Copy the secret's **Value** immediately — it's only shown once.
5. **API permissions** — confirm `User.Read` (Microsoft Graph, delegated) is listed; it's added by default on a new registration. As of phase 2, CRMITdesk also requests `GroupMember.Read.All` (delegated) at every sign-in — add it here too if it isn't already listed (Add a permission → Microsoft Graph → Delegated permissions → search `GroupMember.Read.All`).
6. **Grant admin consent now, before testing sign-in** — click **Grant admin consent for `<tenant>`** on this same API permissions page. Many tenants restrict user self-consent, in which case skipping this step means every sign-in attempt (even from an admin account) fails with "Need admin approval" instead of reaching the Microsoft login form. This is a one-time step per app registration/tenant.

## 2. Configure the integration in CRMITdesk

1. Log in at your Netlify URL as a `SUPER_ADMIN` or `IT_MANAGER`.
2. Go to **Integrations → Single Sign-On** (`/directory-sso`).
3. Enter the Tenant ID, Client ID, and Client Secret from step 1. Pick a login slug (e.g. `test`).
4. Save.
5. Copy the **Redirect URI** now shown on the page — it should read `https://crm-itdesk-server.onrender.com/api/auth/entra/callback` (the Render URL, not Netlify). Go back to Entra: **Authentication → Add a platform → Web**, paste it in, save. Must match exactly.
6. Click **Test** — should return "Tenant found...". If it fails, it's almost always a typo'd tenant ID, or (less likely) Render's outbound network blocking the request — Render's free tier doesn't block outbound HTTPS the way it blocks outbound SMTP, so this should work on the free plan.

## 3. Happy path: first-time sign-in

1. Make sure at least one existing CRMITdesk user's email matches a real account in that Entra tenant (invite one with that email, or use an account you already control there).
2. Open an incognito/private window pointed at your **Netlify URL** (avoids stale localStorage tokens interfering).
3. Go to `https://<your-netlify-site>/login/<slug>`.
4. Should redirect to `login.microsoftonline.com`. **If this hangs for 20-50 seconds first** — that's Render's free-tier cold start waking the backend up after inactivity, not a bug in the flow; give it a minute the first time.
5. Sign in with the matching Microsoft account. First time, Microsoft may show a consent screen — accept it.
6. Should land back on `https://<your-netlify-site>/sso-callback` (brief "Finishing sign-in..." spinner), then `/dashboard`, fully logged in.
7. Verify: correct name/role showing; refresh and confirm the session persists.
8. **If step 6 gets stuck on "Finishing sign-in..."** — open devtools → Network tab, look at the `/auth/me` request. A CORS error here means `CORS_ORIGIN` on Render doesn't match your Netlify origin exactly (check for a trailing slash mismatch, `www.` vs no-`www.`, or `http` vs `https`).
9. Check the audit log for a `LOGIN` entry with `method: entra`, and confirm that user's `entra_object_id` column is now populated in the database.

## 4. Second sign-in (already linked)

Log out, repeat step 3. This time Microsoft should skip the consent screen and you should land straight back in the app — confirms the lookup-by-`entraObjectId` path works, not just the one-time email-linking path.

## 5. Edge cases

Each of these should fail *gracefully* with a clear message, not a blank page or raw error:

- **Wrong slug** — visit `/login/not-a-real-slug` → redirects to `/login` with "That sign-in link isn't recognized."
- **SSO disabled** — toggle Enabled off on the settings page, try the login link → "Single sign-on is currently turned off..."
- **No matching account** — sign in with a Microsoft account whose email doesn't match any user in that org → lands on `/sso-callback` with "No CRMITdesk account was found for you" and a link back to `/login`.
- **Deactivated user** — deactivate a user who's already linked their Entra account, try signing in again → "Your account is deactivated."
- **Password login still works** — confirm normal email/password login from Netlify is unaffected.
- **Secret not wiped on unrelated edits** — go back to settings, leave Client Secret blank, change only the slug or toggle, save → confirm sign-in still works afterward.
- **Disconnect** — click Disconnect → config removed, `/login/<slug>` now says "not recognized."

## 6. Multi-tenant isolation (if you're testing with 2+ orgs)

If two CRMITdesk orgs each have their own Entra tenant configured (different slugs), confirm a user signing in via org A's slug can only ever land in an org A account — never cross into org B. Enforced by scoping every lookup to the org resolved from the signed `state` param, but worth confirming directly.

## 7. Quick security/config spot-checks

- Devtools → Network tab on the Single Sign-On settings page: confirm `GET /api/directory/config` never returns the actual client secret (only `hasClientSecret: true/false`).
- Log in as an `EMPLOYEE`-role user, confirm hitting `/api/directory/config` directly on the Render API returns 403.
- Confirm both Netlify and Render are serving over HTTPS (both do by default) — the tokens in the `/sso-callback` URL fragment and the OAuth `code` both rely on TLS.
- Double-check `CORS_ORIGIN` on Render is your exact Netlify origin and nothing looser (not `*`) — this is the one place a Netlify/Render split app is more exposed than a same-origin deployment, so it's worth being precise here rather than widening it to make an error go away.

---

Once these pass, phase 1 is solid ground to build phase 2 (JIT provisioning + group-to-role mapping) on top of. Keep this test tenant around — phase 2 will need the same app registration plus a couple of Entra security groups to test role mapping against.

---

# Phase 2 — Auto-provisioning + group-to-role mapping

Phase 2 adds one new setting (`autoProvisioningEnabled`/`defaultRole` on the config) and a `DirectoryRoleMapping` table, both surfaced on the same **Integrations → Single Sign-On** page. No new Entra app permission is required beyond phase 1 — `GroupMember.Read.All` (delegated) is already requested at sign-in as of this phase (see `entraAuth.ts`'s `DELEGATED_SCOPE`); Microsoft may show a fresh consent prompt for it the next time someone signs in even if nothing else changed.

## 8. Set up test groups in Entra

1. **Microsoft Entra ID → Groups → New group.** Create two security groups, e.g. "CRMITdesk IT Agents" and "CRMITdesk Sales". Add a couple of test users to each (users who do **not** yet have CRMITdesk accounts, to actually exercise pre-creation/JIT-creation).
2. Copy each group's **Object ID** (Group → Overview) — this is what goes into the mapping's "Entra group object ID" field, not the group name.

## 9. Configure auto-provisioning + mappings

1. On `/directory-sso`, under **Automatic provisioning**, check "Automatically create accounts for new Microsoft sign-ins" and pick a **Default role** (e.g. Employee). Save.
2. Under **Group → role mapping**, add a mapping for each test group: paste the Object ID, a label of your choice, pick a role, leave priority at 0 (or set a higher number on whichever group should win if a user is in both).
3. Confirm the mapping list shows both rows after saving.

## 10. JIT provisioning — new user, first sign-in

1. In an incognito window, go to `https://<your-netlify-site>/login/<slug>` and sign in as one of the test users you added to a mapped group (someone with **no** existing CRMITdesk account).
2. Should land in the app fully logged in, with the role from the matching group mapping — check the Users admin page to confirm the account now exists with `provisionedVia: DIRECTORY` and the right role.
3. Sign in as a test user who is **not** in any mapped group — should still get an account, but with the org's configured default role.
4. Turn off "Automatically create accounts" and try signing in as a brand-new (never-seen) Microsoft account — should now fail with "No CRMITdesk account was found for you," confirming the setting actually gates creation.
5. Check the audit log — each JIT-created account should have a `CREATE` entry with `method: entra_jit`.
6. **Seat limit check:** if the org's plan is near its seat cap, try JIT-provisioning one more billable-role (non-Employee) user than seats allow — should fail gracefully with "Your organization has reached its user limit," not a 500.

---

# Phase 3 — Scheduled sync (pre-create + deprovision)

Phase 3 adds a daily unattended sync (GitHub Actions → `POST /api/directory/sync-all`) plus a manual "Sync Now" button, both running the same `syncOrgDirectory()` logic. Unlike sign-in, this runs **without** a user in the loop, so it needs an app-only Graph token — which requires a **separate** Entra admin-consent step beyond phase 1/2.

## 11. Grant the app-only Graph permission

The delegated `GroupMember.Read.All` scope used at sign-in does **not** cover the unattended sync — Graph's `/groups/{id}/members` call here uses a `client_credentials` (app-only) token, which needs its own permission grant:

1. In the same Entra app registration used for SSO: **API permissions → Add a permission → Microsoft Graph → Application permissions** (not Delegated) → search for and add `GroupMember.Read.All`.
2. Click **Grant admin consent for `<tenant>`** — application permissions can't be consented to by an end user at sign-in time; a tenant admin must do this explicitly, once.
3. Confirm the permissions list now shows `GroupMember.Read.All` twice — once under Delegated (phase 1/2, status depends on user consent), once under Application (phase 3, should show a green "Granted" checkmark after step 2).

Skipping this step doesn't break sign-in or JIT provisioning — only the sync (manual or scheduled) will fail, with an error surfaced in the sync log / "Sync Now" response (Graph returns 403 on the group-members call).

## 12. Manual sync — "Sync Now"

1. With auto-provisioning still on and both group mappings from phase 2 still configured, click **Sync Now** on the Single Sign-On settings page.
2. Should complete and show a new row in the sync history: "Succeeded", with counts like "+N created, 0 deactivated" if any mapped-group members didn't already have accounts.
3. Confirm any newly pre-created users show up in the Users admin page with `provisionedVia: DIRECTORY`, without ever having signed in themselves.
4. Remove a test user from one of the mapped Entra groups (don't delete their CRMITdesk account), run **Sync Now** again — that user should now be deactivated (`isActive: false`), and the sync history row should show it under "deactivated." Confirm they can no longer log in.
5. **Negative case:** turn off auto-provisioning, click Sync Now → should fail immediately with a clear "Automatic provisioning is off" message, not attempt a partial sync.

## 13. Scheduled (unattended) sync via GitHub Actions

1. On Render, set `DIRECTORY_SYNC_SECRET` to a long random value (Environment tab — see `render.yaml`'s comment). Redeploy.
2. In the GitHub repo, add a matching repo secret `DIRECTORY_SYNC_SECRET` (Settings → Secrets and variables → Actions) with the exact same value.
3. Go to the repo's **Actions** tab → "Directory sync" workflow → **Run workflow** (manual trigger via `workflow_dispatch`, don't wait for the 04:00 UTC cron).
4. Should complete green. Check the run log — the `curl` should report HTTP 200, and the printed JSON should list a result per eligible org.
5. Confirm a new row appears in the Single Sign-On page's sync history for the org(s) that had both SSO and auto-provisioning enabled — orgs without auto-provisioning on are skipped entirely (not included in `syncAllOrgs()`'s query).
6. **Secret mismatch check:** temporarily change the GitHub secret's value (don't touch Render's), re-run → should fail with a 404 (not 401/403 — this endpoint intentionally hides its existence rather than revealing "secret was wrong").
7. **Unset secret check:** if `DIRECTORY_SYNC_SECRET` was never set on Render, the same workflow should also 404 — confirms the endpoint fails closed by default rather than being silently open.

## 14. Multi-org isolation (if testing with 2+ orgs)

If two orgs both have SSO + auto-provisioning + mappings configured against different Entra tenants, confirm one sync run never creates or deactivates users in the wrong org — `syncOrgDirectory()` is called once per `orgId` and every query inside it is scoped to that org, but worth confirming directly against real data once.
