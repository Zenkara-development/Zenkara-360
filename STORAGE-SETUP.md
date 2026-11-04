# Attachment storage — where to configure what

## The three options, at a glance

Each organisation picks exactly one. It can be changed later.

| Option | Whose account | Whose bill | Needs setup by you first? | Plan-gated? |
|---|---|---|---|---|
| **Their own Google Drive** | The customer's | The customer's | Yes — one Google Cloud OAuth app | No |
| **Their own S3-compatible bucket** | The customer's | The customer's | **No** | No |
| **Your hosted storage** | Yours | Yours | Yes — one bucket | Yes: Free 0GB / Pro 5GB / Enterprise 50GB |

**There is no single account that stores everybody's files.** Every client connects
*their own*. Your own organisation is not special — you connect yours through the
same screen.

"S3-compatible" covers **Amazon S3, Cloudflare R2, Wasabi, Backblaze B2,
DigitalOcean Spaces and MinIO** — they all speak the same protocol, so one option
covers all of them. (Azure Blob does **not**; it is a different API.) This is the
only option that needs nothing configured on your side, which makes it the one that
works on every install, including air-gapped and self-hosted ones.

## The two configuration levels

| Level | Who does it | Where | How often |
|---|---|---|---|
| 1. Enable Google Drive / hosted storage | You, the platform operator | Env vars, or **Platform Admin → Platform settings** | Once per deployment |
| 2. Connect an account | Each client's own org owner | In the app: **Storage** page (`/storage`) | Once per client org |

Level 1 is **not needed at all** if your customers use their own S3 buckets.

> **Creating the bucket itself** — AWS and Cloudflare R2 walkthroughs, the exact
> IAM policy, and what each connection-test failure means: see
> [`S3-BUCKET-SETUP.md`](./S3-BUCKET-SETUP.md).

---

## Level 1 — Enable it on the deployment (you, once)

### 1a. Create the Google OAuth client

1. Go to <https://console.cloud.google.com/> and create a project (or pick one).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External** (unless every client is in your own Workspace).
   - Fill in app name, support email, developer email.
   - **Scopes** — add exactly these two:
     - `.../auth/drive.file`
     - `.../auth/userinfo.email`
   - Publish the app. While it is in *Testing*, only accounts you list as test
     users can connect, and refresh tokens expire after 7 days — which will look
     like "everyone's attachments broke after a week". Publish before onboarding
     real clients.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorised redirect URI** — this must match byte for byte:

     ```
     https://<your-backend-domain>/api/storage/google/callback
     ```

     For local development: `http://localhost:4000/api/storage/google/callback`
   - Copy the **Client ID** and **Client secret**.

> **Why `drive.file` and not full Drive access?** `drive.file` lets the app see
> and manage *only the files it created itself*. It keeps the consent screen at
> Google's "sensitive" tier. Full Drive access is a "restricted" scope and needs
> a paid annual third-party security assessment before Google will let you use it
> in production. See `server/src/utils/googleDrive.ts`.

### 1b. Set the environment variables

On Render (or wherever the **server** runs) — Dashboard → your service →
Environment:

```bash
# Google Drive (bring-your-own, per client org)
GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx

# The backend's OWN public URL. The redirect URI is built from this as
# `${APP_URL}/api/storage/google/callback`, so if this is wrong or still
# localhost, Google returns redirect_uri_mismatch.
APP_URL=https://your-backend.onrender.com

# Where the user's browser is sent back to after consent (the /storage page).
FRONTEND_URL=https://your-frontend.onrender.com

# Refresh tokens are encrypted at rest with this before hitting the database.
# Required — without it, connecting will fail.
ENCRYPTION_KEY=<32+ random characters>

# Already set for auth; also signs the 10-minute OAuth `state` parameter
# that proves which org started the connection.
JWT_SECRET=<your existing value>
```

**Optional — hosted storage** (your own S3/R2/MinIO bucket, offered to clients
whose plan includes a quota). You can set this **either** here **or** in the
console at **Platform Admin → Platform settings → Hosted attachment storage**,
which takes effect immediately with no redeploy:

```bash
S3_BUCKET=crmitdesk-attachments
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto                       # 'auto' for Cloudflare R2
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # omit for real AWS S3
```

The console layers over the environment **per field**: anything set there wins,
anything left blank falls back to the env var. So you can override just the bucket
and keep the credentials in the environment. The screen shows, for each secret,
whether it came from the database or the environment, and has a **Test connection**
button that round-trips a probe object against whatever is live right now.

Setting the bucket in the console is the better default for a running deployment —
a redeploy to change a bucket name is a needless outage.

Restart the service. The Storage page reads
`GET /api/storage/status`, whose `configured` and `hosted.available` flags come
straight from whether these variables are set — so if an option is greyed out in
the UI, that is the variable that is missing.

---

## Level 2 — Connect an account (each org, in the app)

**Where:** left sidebar → **Integrations → Storage**, or go directly to
`/storage`.

**Who can see it:** SUPER_ADMIN, IT_MANAGER, CRM_MANAGER.
**Who can change it:** SUPER_ADMIN of that organisation only. Connecting an
OAuth integration is treated at the same trust level as billing, so managers can
see the status but not rewire it.

### Option A — the org's own Google Drive

1. Storage page → **Your own Google Drive** → **Connect**.
2. You are sent to Google's consent screen. Sign in as the account whose Drive
   should hold the files — usually a shared/service account owned by the
   business, **not** an individual employee who might leave.
3. On approval you land back on `/storage` with the connected email shown.
4. The app creates a folder called **`CRMITdesk Evolved Attachments`** in that
   Drive. Every attachment from every record in that org goes there.

Storage used is the client's own Google quota. Nothing counts against their
CRMITdesk plan.

### Option B — the org's own S3-compatible bucket

Storage page → **Your own S3-compatible storage** → **Connect a bucket**.

1. Pick the service (Amazon S3, Cloudflare R2, Wasabi, Backblaze B2, DigitalOcean
   Spaces, MinIO, or "Other"). The endpoint URL is filled in from the choice —
   for R2 the customer types only their account ID.
2. Bucket name, region, access key ID, secret access key. Optionally a folder
   prefix, so a bucket already used for other things can hold CRM files under
   `crm/`.
3. **Test connection** writes a small probe object, reads it back, and deletes it.
4. **Connect bucket**.

The connection is round-tripped again on connect and is **never saved untested**.
Credentials that do not work would otherwise fail on every upload afterwards, with
nothing linking the failure back to the day they were typed in.

The key needs exactly three permissions on that bucket:

```
s3:PutObject
s3:GetObject
s3:DeleteObject
```

Nothing else — no listing, no bucket administration. Delete matters: without it,
removing an attachment in CRMITdesk leaves the file behind accruing storage cost.

Keys are encrypted with `ENCRYPTION_KEY` before being written to the database, the
same as the Google refresh tokens, and are never sent back to a browser.

No plan quota applies — it is the customer's bucket and their bill.

### Option C — hosted storage (your bucket)

Storage page → **Hosted storage** → **Connect**. No OAuth, one click. Requires
both that you set the `S3_*` variables *and* that the org's plan includes a
quota:

| Plan | Hosted storage |
|---|---|
| Free | 0 GB — Drive only |
| Pro | 5 GB |
| Enterprise | 50 GB |

Free-plan orgs only ever see the Google Drive option; the hosted button returns
a clear upgrade message rather than failing silently.

### If no client ever connects anything

Uploads fall back to your hosted bucket automatically **if** `S3_*` is set and
the org's plan has a quota. If S3 is not configured on the deployment, the user
gets a 400 that says to connect storage in Settings → Storage. (Before this
week's fix that path returned a 500 from inside the AWS SDK.)

---

## Switching or disconnecting

The app **blocks** a switch that would strand files, with a 409 saying how many.
The guard fires while attachments exist under either **bring-your-own** provider —
Google Drive or a custom S3 bucket — for any of:

- disconnecting storage
- switching to a different provider
- reconnecting a **different** Google account, or a different bucket

Reconnecting the **same** Google account just refreshes tokens and is always
allowed.

The reason: the files stay exactly where the customer put them, but the credentials
needed to reach them live in one row and get overwritten — so from inside CRMITdesk
they become permanently unreachable, which is worse than an error message. To
proceed, delete those attachments first.

Hosted storage is deliberately **not** guarded: those objects are in your bucket
under a key you control, and a provider switch leaves them reachable.

⚠️ Changing the **platform-wide** bucket is the one case with no guard, because it
affects every org at once. Attachments already in the old bucket stay there and
become unreachable. Migrate the objects first if there are any.

---

## Per-client onboarding checklist

For each new client organisation:

1. Their SUPER_ADMIN signs in.
2. **Integrations → Storage**.
3. Pick one:
   - **Connect Google Drive** — sign in as *their* business Google account.
   - **Connect a bucket** — their own S3/R2/Wasabi/B2/Spaces/MinIO bucket. Test
     connection must pass before it saves.
   - **Use hosted storage** — Pro/Enterprise only.
4. Confirm the green banner names the expected account or bucket.
5. Upload one test file to any record, download it back, then delete it.

Two things worth saying out loud to a client at step 3:

- On Drive: **whoever signs in owns the Drive holding their data.** A departing
  employee's personal Google account is the failure case to avoid — use a shared
  business account.
- On their own bucket: give us a key scoped to that one bucket with only the three
  permissions above. Do not hand over a root or master key.

Step 5 is not busywork — download and delete exercise permissions that upload
alone does not, and the connect-time probe already checks all three precisely
because a write-only key looks fine until weeks later.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | `APP_URL` does not match the authorised redirect URI in Google Cloud Console — including `http` vs `https` and any trailing slash. |
| "Google Drive isn't configured on this deployment yet" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing on the server. |
| "Google did not return a long-lived connection" | The account previously granted access and Google withheld a new refresh token. Revoke at <https://myaccount.google.com/permissions> and connect again. |
| "This connection link has expired" | The signed `state` lasts 10 minutes. Start from **Connect** again. |
| Connections break roughly weekly | The OAuth consent screen is still in **Testing**. Publish it. |
| "This organization's Google Drive connection has changed since this file was uploaded" | The org reconnected a different Google account at some point. The file is still in the old Drive, just not reachable from here. |
| Hosted storage button does nothing / 400 | No bucket configured — set one in Platform Admin → Platform settings, or as `S3_*` env vars. |
| Hosted storage 402 | The org's plan has a 0 GB quota (Free). |
| Own-bucket test fails on **write** | The key lacks `s3:PutObject`, or the bucket name is wrong. |
| Own-bucket test fails on **read** | The key has `s3:PutObject` but not `s3:GetObject` — files would upload and never open. |
| Own-bucket test fails on **delete** | The key lacks `s3:DeleteObject` — deletions would leave files behind, billed to the customer. |
| "That bucket does not exist" but it clearly does | The region is wrong. The region is part of the request signature, so a mismatch often surfaces as a missing bucket. |
| "The secret access key does not match the key ID" | Usually a truncated paste, or the wrong region again. |
| R2 rejects everything | Region must be `auto`, and the endpoint must use the account ID, not the bucket name. |

---

## What the code does with the files

- Uploads never touch the server's local disk — the buffer goes straight from
  the request to Drive or S3. Render wipes local disk on every redeploy, so a
  local-disk path would silently lose every attachment.
- Downloads stream back **through** the API rather than redirecting to a Drive
  link, so access is governed by CRMITdesk's own org/permission checks, not by
  Google Drive sharing settings. Staff without a Google account can still
  download.
- Refresh tokens are encrypted with `ENCRYPTION_KEY` before being stored, and
  refreshed transparently 60 seconds before expiry.
- Uploads are limited to 25 MB, with an extension allowlist enforced before the
  file is buffered (`server/src/utils/uploadPolicy.ts`).
- Deleting a record now deletes its attachments — rows *and* the stored files —
  and a daily sweep catches anything the database cascaded away behind the
  application's back (`server/src/utils/entityCleanup.ts`).

- A customer's own bucket is never silently swapped for ours. If their config is
  incomplete the upload fails loudly, because the whole reason they chose their
  own bucket is that the data must not sit with us.

Relevant source: `server/src/modules/storage/`, `server/src/utils/storage.ts`
(provider dispatch), `server/src/utils/googleDrive.ts`,
`server/src/utils/s3Storage.ts` (both S3 paths + the connection probe),
`server/src/utils/platformSettings.ts` (platform config, DB over env),
`client/src/pages/StoragePage.tsx`, `client/src/pages/storage/CustomS3Form.tsx`.
