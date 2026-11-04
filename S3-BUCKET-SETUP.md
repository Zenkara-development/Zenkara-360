# Creating an S3 bucket for CRMITdesk attachments

Step-by-step for the cloud side — creating the bucket and a key that can only
touch it. `STORAGE-SETUP.md` covers where the values then go; this covers where
they come from.

Walkthroughs below for **Amazon S3** and **Cloudflare R2**. Wasabi, Backblaze B2,
DigitalOcean Spaces and MinIO follow the same shape: create a bucket, create a key
scoped to it, copy the endpoint.

---

## First: decide which of the two it is

Same bucket, same credentials, two different screens depending on who it is for.

| | Where you enter it | Who uses that bucket |
|---|---|---|
| **Platform-wide** | Platform Admin → Platform settings → *Hosted attachment storage* | Every org on a paid plan that hasn't connected their own storage |
| **Just one organisation** | Storage → *Your own S3-compatible storage* → Connect a bucket | That one org only |

If you are setting up storage for **your own company's use of the product**, it is
the second one — your org connects a bucket the same way any customer would.

If you are setting up the storage that **your customers get by default**, it is the
first one.

You can do both, with different buckets.

---

## Amazon S3

### 1. Create the bucket

AWS console → **S3** → **Create bucket**.

- **Bucket name** — globally unique across all of AWS. `acme-crmitdesk-attachments`.
- **Region** — pick one near your users and **write it down**. The region is part
  of the request signature, so getting it wrong later surfaces as
  *"That bucket does not exist"* even though it plainly does. This is the single
  most common setup mistake.
- **Block all public access** — leave it **ON** (the default). Files are never
  served directly from the bucket; downloads stream through the API so that
  CRMITdesk's own permission checks apply. Nothing here should be public.
- **Versioning** — optional. Turning it on means a deleted attachment is
  recoverable, at the cost of storing every version. Off is fine.
- **Encryption** — leave the default (SSE-S3). It costs nothing.

Create it.

### 2. Create a policy that only allows those three actions

IAM → **Policies** → **Create policy** → **JSON** tab. Paste this, replacing the
bucket name:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CrmitdeskAttachments",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::acme-crmitdesk-attachments/*"
    }
  ]
}
```

Name it something like `crmitdesk-attachments-rw`.

Two things people get wrong here:

- **The `/*` matters.** `arn:aws:s3:::bucket` is the bucket itself;
  `arn:aws:s3:::bucket/*` is the objects in it. These three actions operate on
  objects, so without the `/*` every request is denied.
- **Include `s3:DeleteObject`.** It is tempting to leave it out as a safety
  measure. Don't — without it, deleting an attachment in CRMITdesk removes the
  row but leaves the file in your bucket forever, silently accruing cost. The
  connection test fails on the delete step specifically so you find this now
  rather than in a year's storage bill.

`s3:ListBucket` is deliberately absent. Nothing in the product lists the bucket.

### 3. Create a user and a key

IAM → **Users** → **Create user**.

- Name: `crmitdesk-attachments`
- **Do not** tick "Provide user access to the AWS Management Console" — this
  identity is for the API only.
- **Attach policies directly** → select the policy from step 2.
- Create.

Then open the user → **Security credentials** → **Create access key** → choose
**Application running outside AWS** → Create.

Copy the **Access key ID** and **Secret access key** now. AWS shows the secret
exactly once.

### 4. Fill it in

| Field | Value |
|---|---|
| Service | Amazon S3 |
| Bucket | `acme-crmitdesk-attachments` |
| Region | the region from step 1, e.g. `eu-west-1` |
| Endpoint | **leave blank** |
| Access key ID | from step 3 |
| Secret access key | from step 3 |

Press **Test connection**. It writes a small file, reads it back, and deletes it.

---

## Cloudflare R2

Worth considering for attachments specifically: R2 charges **nothing for egress**,
and attachments are a download-heavy workload. On S3 you pay per gigabyte
downloaded; on R2 you don't.

### 1. Create the bucket

Cloudflare dashboard → **R2** → **Create bucket**.

- **Bucket name** — only has to be unique within your account.
- **Location** — a hint, not a hard region. The region you enter in CRMITdesk is
  always `auto` regardless of what you pick here.

### 2. Create a scoped API token

R2 → **Manage R2 API Tokens** → **Create API token**.

- **Permissions**: *Object Read & Write*.
- **Specify bucket** → the bucket from step 1. Do not leave it on "all buckets".
- Create.

Copy the **Access Key ID** and **Secret Access Key**. Ignore the "token value" —
CRMITdesk uses the S3-compatible key pair, not the Cloudflare API token.

### 3. Get your account ID

It is on the R2 overview page, and it is also the hex string in your dashboard
URL: `dash.cloudflare.com/<account-id>/r2`.

### 4. Fill it in

| Field | Value |
|---|---|
| Service | Cloudflare R2 |
| Cloudflare account ID | from step 3 — the endpoint is built from this |
| Bucket | your bucket name |
| Region | `auto` (pre-filled) |
| Access key ID | from step 2 |
| Secret access key | from step 2 |

Press **Test connection**.

If you are entering this in the **platform console** rather than the org Storage
page, there is no account-ID field — type the endpoint directly:

```
https://<account-id>.r2.cloudflarestorage.com
```

---

## The other providers, briefly

| Provider | Endpoint | Region |
|---|---|---|
| Wasabi | `https://s3.<region>.wasabisys.com` | Real, must match the bucket |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | e.g. `us-west-004`. Use an **application key**, not the master key |
| DigitalOcean Spaces | `https://<region>.digitaloceanspaces.com` | The datacentre code: `nyc3`, `fra1`, `sgp1` |
| MinIO / self-hosted | Your server's full URL, including the port | Usually `us-east-1`, but anything the server accepts |

The Storage page fills the endpoint in for you once you pick the service — you
only ever type the parts that are actually yours.

---

## Things you do *not* need to configure

- **CORS.** Browsers never talk to the bucket directly. Uploads go to the API and
  downloads stream back through it, so CRMITdesk's org and permission checks
  apply to every byte. A public or CORS-enabled bucket would be a downgrade.
- **A public access policy.** Same reason. Keep public access blocked.
- **Folder structure.** Objects are keyed `<orgId>/<timestamp>-<uuid>-<filename>`
  automatically. Set a folder prefix only if you want everything under a path
  inside a bucket you already use for other things.

## Optional, but sensible

- **Lifecycle rule to abort incomplete multipart uploads after 1 day.** Not
  something this product creates, but a good hygiene default on any bucket.
- **Versioning** if you want deleted attachments to be recoverable.
- **A separate bucket per environment.** Pointing staging and production at the
  same bucket means a staging test deletes production files.

## If the test fails

| Message | What it actually means |
|---|---|
| Failed on **write** | The key lacks `s3:PutObject`, or the policy `Resource` is missing its `/*`, or the bucket name is wrong |
| Failed on **read** | `s3:GetObject` missing — uploads would work and files would never open |
| Failed on **delete** | `s3:DeleteObject` missing — deletions would leave files behind, billed to you |
| "That bucket does not exist" | Almost always the wrong **region** |
| "The secret access key does not match the key ID" | A truncated paste, or again the wrong region — the region is part of the signature |
| "That endpoint hostname does not resolve" | Typo in the endpoint, or the R2 account ID is wrong |
