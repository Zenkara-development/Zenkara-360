#!/bin/bash
#
# Pull-based deployer. Runs on the EC2 instance once a minute via
# zenkara-deploy.timer, and does nothing at all unless a new release has
# been published.
#
# The instance reaches OUT to S3 with an IAM instance role, so nothing has
# to connect in: no deploy key in GitHub, and port 22 can stay restricted
# to your own address.
#
# Flow: read current.txt -> compare with what is deployed -> if different,
# fetch that release, apply it, restart, record the sha.
#
# Install: see deploy/README.md
set -euo pipefail

BUCKET="${ZENKARA_DEPLOY_BUCKET:-zenkara-deploy}"
APP=/opt/zenkara-crm
STATE=/var/lib/zenkara-deploy
STAMP="$STATE/deployed-sha"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$STATE"

log() { echo "[$(date -Is)] $*"; }

# ── Is there anything to do? ────────────────────────────────────────────
# Keep stderr: "no release published yet" and "the IAM role is wrong" are
# very different problems, and collapsing both into one message sent us
# chasing the wrong one.
ERR="$WORK/s3.err"
WANT=$(aws s3 cp "s3://$BUCKET/current.txt" - 2>"$ERR" | tr -d '[:space:]' || true)
if [ -z "$WANT" ]; then
  if grep -qi "AccessDenied\|Unable to locate credentials\|InvalidAccessKeyId" "$ERR"; then
    log "ERROR: cannot read s3://$BUCKET/current.txt — the instance IAM role is missing or lacks s3:GetObject"
    log "  check: aws sts get-caller-identity   /   aws s3 ls s3://$BUCKET/"
  elif grep -qi "Not Found\|does not exist\|NoSuchKey\|NoSuchBucket" "$ERR"; then
    # Normal before the first successful workflow run. Said once per hour
    # rather than every minute, so it does not bury real errors.
    if [ ! -f "$STATE/.notified-empty" ] || [ "$(find "$STATE/.notified-empty" -mmin +60 2>/dev/null)" ]; then
      log "no release published yet (s3://$BUCKET/current.txt absent) — waiting for the Deploy workflow"
      touch "$STATE/.notified-empty"
    fi
  else
    log "could not read s3://$BUCKET/current.txt: $(head -1 "$ERR")"
  fi
  exit 0
fi

HAVE=$(cat "$STAMP" 2>/dev/null || echo "none")
if [ "$WANT" = "$HAVE" ]; then
  exit 0          # already current; the common case, stay silent
fi

log "new release $WANT (have: $HAVE) — deploying"

# ── Fetch ───────────────────────────────────────────────────────────────
# Everything is downloaded and verified BEFORE anything on the box is
# touched, so a broken or partial release cannot take the site down.
aws s3 cp "s3://$BUCKET/releases/$WANT/server-dist.tar.gz" "$WORK/server-dist.tar.gz"
aws s3 cp "s3://$BUCKET/releases/$WANT/client-dist.tar.gz" "$WORK/client-dist.tar.gz"
aws s3 cp "s3://$BUCKET/releases/$WANT/package-lock.json"  "$WORK/package-lock.json"

tar -tzf "$WORK/server-dist.tar.gz" >/dev/null
tar -tzf "$WORK/client-dist.tar.gz" >/dev/null

# ── Source tree ─────────────────────────────────────────────────────────
# The tarballs hold compiled output only. prisma/schema.prisma and the
# migrations are read from disk at deploy time, so the checkout has to move
# to the same commit.
cd "$APP"
git fetch --quiet origin
git reset --hard --quiet "$WANT"

# ── Dependencies, only when they actually changed ───────────────────────
# Compared against a hash recorded at the last successful install, NOT
# against the checked-out file: `git reset --hard` above has already
# rewritten package-lock.json, so comparing the two files always found them
# identical and npm ci never ran. A release that added a dependency then
# built fine in CI and crash-looped here with MODULE_NOT_FOUND — which is
# exactly how pdfkit took the API down.
LOCK_HASH=$(sha256sum "$APP/package-lock.json" | cut -d' ' -f1)
if [ "$LOCK_HASH" != "$(cat "$STATE/lock-hash" 2>/dev/null)" ]; then
  log "dependencies changed — running npm ci"
  npm ci
  echo "$LOCK_HASH" > "$STATE/lock-hash"
else
  log "dependencies unchanged"
fi

# ── Apply ───────────────────────────────────────────────────────────────
# git reset above restored the committed (unbuilt) tree, so the CI-built
# output goes on top of it.
rm -rf "$APP/server/dist" "$APP/client/dist"
tar -xzf "$WORK/server-dist.tar.gz" -C "$APP/server"
tar -xzf "$WORK/client-dist.tar.gz" -C "$APP/client"

test -f "$APP/server/dist/index.js"
test -f "$APP/client/dist/index.html"

# Served at /deployed.txt so CI (and you) can see what is actually
# live, rather than what was merely published.
echo "$WANT" > "$APP/client/dist/deployed.txt"

cd "$APP/server"
npx prisma generate

# Back up before migrating, but only when there is actually something to
# apply. `migrate deploy` can drop columns and rewrite data, and once it has
# run there is no undo — the dump is the only way back. Skipping it when
# there are no pending migrations keeps ordinary code-only deploys fast.
if npx prisma migrate status 2>&1 | grep -qi "following migration.*not yet been applied\|pending"; then
  log "pending migrations detected — backing up the database first"
  if [ -x /usr/local/bin/zenkara-crm-backup.sh ]; then
    /usr/local/bin/zenkara-crm-backup.sh
  else
    # Fall back to an inline dump rather than migrating unprotected.
    mkdir -p /var/backups/zenkara-crm
    sudo -u postgres pg_dump --no-owner --no-privileges zenkara_crm \
      | gzip > "/var/backups/zenkara-crm/pre-migrate_${WANT:0:7}_$(date +%F_%H%M).sql.gz"
  fi
  log "backup complete"
fi

npx prisma migrate deploy

# ── Restart ─────────────────────────────────────────────────────────────
systemctl restart zenkara-crm-api
systemctl reload nginx

# Only record success AFTER the API answers — otherwise a crash-looping
# release would be marked deployed and never retried.
for i in $(seq 1 15); do
  if curl -fsS -o /dev/null http://127.0.0.1:4000/health; then
    echo "$WANT" > "$STAMP"
    log "deployed $WANT successfully"
    exit 0
  fi
  sleep 2
done

log "ERROR: API did not become healthy after deploying $WANT"
log "  journalctl -u zenkara-crm-api -n 50"
exit 1
