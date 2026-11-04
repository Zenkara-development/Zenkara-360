#!/bin/bash
#
# Dumps the CRM database to /var/backups/zenkara-crm, keeps 14 days there,
# and copies each dump to s3://$BACKUP_S3_BUCKET/backups/ when that is set.
#
# Runs nightly via zenkara-crm-backup.timer (installed by setup-server.sh),
# and zenkara-pull-deploy.sh calls it before applying any migration.
# Restore:  gunzip -c <file>.sql.gz | sudo -u postgres psql zenkara_crm
set -euo pipefail

DB="${ZENKARA_DB_NAME:-zenkara_crm}"
DIR=/var/backups/zenkara-crm
FILE="$DIR/${DB}_$(date +%F_%H%M).sql.gz"

mkdir -p "$DIR"
chmod 700 "$DIR"
sudo -u postgres pg_dump --no-owner --no-privileges "$DB" | gzip > "$FILE"
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"

find "$DIR" -name "${DB}_*.sql.gz" -mtime +14 -delete

# The puller calls this with only ZENKARA_DEPLOY_BUCKET set — same bucket.
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-${ZENKARA_DEPLOY_BUCKET:-}}"
if [ -n "$BACKUP_S3_BUCKET" ]; then
  aws s3 cp "$FILE" "s3://$BACKUP_S3_BUCKET/backups/$(basename "$FILE")" --only-show-errors
  echo "copied to s3://$BACKUP_S3_BUCKET/backups/"
fi
