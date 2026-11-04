# Go live on a fresh AWS Ubuntu server

```
push to main
   └─► GitHub Actions: npm ci, prisma generate, tsc, tests, vite build
        └─► s3://<bucket>/releases/<sha>/{server,client}-dist.tar.gz
             └─► current.txt  ← written last, the only thing the box watches
                  └─► EC2 timer (every 60s) notices, pulls, migrates, restarts
```

Nothing connects *into* the server. GitHub writes to a bucket with a
short-lived OIDC role, the instance reads it with its own IAM role — no AWS
keys or SSH keys are stored in GitHub, and port 22 can stay restricted to
your own IP.

Everything below starts from zero: new AWS resources, new GitHub repo, an
empty PostgreSQL database and freshly generated secrets. Nothing from the
previous server (database, JWT/encryption keys, repo, AI keys) is reused.

Throughout, replace:

| Placeholder | Example |
|---|---|
| `<domain>` | `crm.example.com` — the CRM is served at the root of it |
| `<bucket>` | `zenkara360-deploy` (S3 names are global — pick a unique one) |
| `<region>` | `ap-south-1` |
| `<account-id>` | your 12-digit AWS account ID |
| `<github-user>/<repo>` | your new GitHub repository |

---

## 1. GitHub repository

Create a new **private** repository and push this folder to it as a fresh
history (`git init` — do not clone or fork the old repository).

Repository → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account-id>:role/ZenkaraGitHubDeploy` (step 3) |
| Variable | `SITE_DOMAIN` | `<domain>` |
| Variable | `DEPLOY_S3_BUCKET` | `<bucket>` |
| Variable | `AWS_REGION` | `<region>` |
| Variable | `GOOGLE_CLIENT_ID` | optional — shows "Sign in with Google" |

Optional, only if you use the feature: secrets `DEMO_RESET_SECRET` /
`DIRECTORY_SYNC_SECRET` (must equal the same values in `server/.env`), and
the four `ANDROID_KEY*` secrets for signed Play Store builds (see
`.github/workflows/android.yml`). `keep-alive.yml` and `db-backup.yml` do
nothing unless configured — they are not needed on AWS. Disable the
**Reset demo data** workflow in the Actions tab for a live site.

## 2. S3 bucket

Private; nothing here is public.

```bash
aws s3 mb s3://<bucket> --region <region>
aws s3api put-public-access-block --bucket <bucket> \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
aws s3api put-bucket-lifecycle-configuration --bucket <bucket> \
  --lifecycle-configuration '{"Rules":[{"ID":"expire-old-releases","Status":"Enabled","Filter":{"Prefix":"releases/"},"Expiration":{"Days":30}},{"ID":"expire-old-backups","Status":"Enabled","Filter":{"Prefix":"backups/"},"Expiration":{"Days":90}}]}'
```

## 3. Let GitHub assume a role (OIDC — no stored keys)

Once per AWS account:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

`trust.json` — the `sub` condition is what stops any other repo assuming
this role:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<github-user>/<repo>:*" }
    }
  }]
}
```

```bash
aws iam create-role --role-name ZenkaraGitHubDeploy --assume-role-policy-document file://trust.json
aws iam put-role-policy --role-name ZenkaraGitHubDeploy --policy-name WriteReleases \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:PutObject"],"Resource":"arn:aws:s3:::<bucket>/*"}]}'
```

## 4. EC2 instance and its role

Launch **Ubuntu 24.04 LTS**, at least **t3.small** (2 GB). Security group:
22 from **your IP only**, 80 and 443 from anywhere. Give it an Elastic IP and
point an `A` record for `<domain>` at it.

The instance role reads releases and writes backups:

```bash
aws iam create-role --role-name ZenkaraEC2Deploy --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam put-role-policy --role-name ZenkaraEC2Deploy --policy-name ReleasesAndBackups \
  --policy-document '{"Version":"2012-10-17","Statement":[
    {"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::<bucket>/*"},
    {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::<bucket>"},
    {"Effect":"Allow","Action":["s3:PutObject"],"Resource":"arn:aws:s3:::<bucket>/backups/*"}]}'

aws iam create-instance-profile --instance-profile-name ZenkaraEC2Deploy
aws iam add-role-to-instance-profile --instance-profile-name ZenkaraEC2Deploy --role-name ZenkaraEC2Deploy
```

EC2 → Instances → select → Actions → Security → **Modify IAM role** →
`ZenkaraEC2Deploy`.

## 5. Deploy key (private repo)

The box runs `git fetch` on every release, so root needs read access:

```bash
sudo ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C zenkara-server
sudo cat /root/.ssh/id_ed25519.pub
```

GitHub repo → Settings → Deploy keys → Add — paste it, **leave "Allow write
access" unticked**.

## 6. Set up the server (one command)

```bash
sudo git clone --depth 1 git@github.com:<github-user>/<repo>.git /tmp/zenkara   # uses root's deploy key; answer 'yes' to GitHub's host key
sudo DOMAIN=<domain> REPO_URL=git@github.com:<github-user>/<repo>.git \
     DEPLOY_BUCKET=<bucket> bash /tmp/zenkara/deploy/setup-server.sh
```

`setup-server.sh` installs Node 20, PostgreSQL, nginx and the AWS CLI;
creates an empty `zenkara_crm` database with a random password; writes
`/opt/zenkara-crm/server/.env` with **new random** `JWT_SECRET`,
`ENCRYPTION_KEY`, `QUOTE_SHARE_SECRET` and `WORKFLOW_WEBHOOK_SECRET` (root
only, never printed); installs the API, release-puller and nightly-backup
systemd units; and configures nginx for `<domain>`. Re-running it is safe —
it never overwrites an existing `.env` or database password.

Then fill in the external keys you created on your own accounts:

```bash
sudo nano /opt/zenkara-crm/server/.env
```

| Key | Where it comes from |
|---|---|
| `SMTP_PASS` | Google Account (zenkaratech@gmail.com) → Security → App passwords |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials (redirect URIs below) |
| `GROQ_API_KEY` or `OPENAI_API_KEY` | console.groq.com / platform.openai.com |
| `S3_*` | only for "hosted storage" — a separate bucket + access key |
| `STRIPE_*` | dashboard.stripe.com; webhook URL `https://<domain>/api/billing/webhook` |
| `TWILIO_*` | twilio.com console (WhatsApp) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |

Google OAuth client — Authorized JavaScript origin `https://<domain>`;
Authorized redirect URIs `https://<domain>/api/storage/google/callback` and
`https://<domain>/api/calendar/callback`.

## 7. First release, HTTPS, first login

Push to `main` (or Actions → Deploy → Run workflow). Within a minute the box
installs dependencies, migrates the empty database and starts the API:

```bash
journalctl -u zenkara-deploy -f
```

Once DNS resolves to the instance:

```bash
sudo bash /opt/zenkara-crm/deploy/enable-https.sh zenkaratech@gmail.com
```

Create your platform-admin login directly against the database (no
bootstrap secret needed):

```bash
cd /opt/zenkara-crm/server
sudo npm run platform:admin -- --email zenkaratech@gmail.com --password '<strong password>' --name 'Your Name'
```

Do **not** run `npm run db:seed` on the live server — it creates the public
demo organisations whose logins (`admin@crmitdesk.com` / `Admin@123`) are
published in this repo.

---

## Day to day

```bash
systemctl status zenkara-crm-api                 # API
journalctl -u zenkara-crm-api -n 100 --no-pager  # API logs
journalctl -u zenkara-deploy -n 50 --no-pager    # what the puller did
cat /var/lib/zenkara-deploy/deployed-sha         # what is live
curl -s https://<domain>/deployed.txt            # same, from outside
sudo systemctl start zenkara-deploy              # force a check now
sudo systemctl start zenkara-crm-backup          # back up now
ls /var/backups/zenkara-crm/                     # local backups (14 days)
```

After editing `server/.env`: `sudo systemctl restart zenkara-crm-api`.

## Safety properties worth knowing

- **`current.txt` is written last.** A half-uploaded release is invisible,
  so the puller can never grab an incomplete set of artifacts.
- **Artifacts are downloaded and verified before anything is touched.** A
  failed download leaves the running site alone.
- **The database is backed up before any pending migration**, and nightly at
  02:30 — locally and to `s3://<bucket>/backups/`.
- **The sha is recorded only after `/health` answers.** A crash-looping
  release is not marked deployed, so the next tick retries it.

## Rolling back

```bash
aws s3 cp s3://<bucket>/current.txt -          # note the current sha
echo "<previous-sha>" | aws s3 cp - s3://<bucket>/current.txt --cache-control no-cache
```

The next tick rolls the instance back within a minute. Releases are kept for
30 days. Restoring data: `gunzip -c <backup>.sql.gz | sudo -u postgres psql zenkara_crm`.

## HTTPS is required

Face verification, geofenced check-in, live location and the installable
PWA all need a secure origin — browsers never show the camera or location
prompt on plain `http://`.
