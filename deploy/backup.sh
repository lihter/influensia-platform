#!/usr/bin/env bash
# Nightly backup: Postgres dump + uploaded files → /var/backups/influensia (7 days) → S3 (BACKUP_BUCKET, 30 days via lifecycle).
# Installed as a systemd timer by host-setup.sh. Run by hand any time:  sudo /opt/influensia/app/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . deploy/.env; set +a
DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
OUT="${BACKUP_DIR:-/var/backups/influensia}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"

$DC exec -T db pg_dump -U influensia -d influensia -Fc > "$OUT/db-$TS.dump"
$DC exec -T app tar -C /data -czf - files > "$OUT/files-$TS.tgz"
test -s "$OUT/db-$TS.dump"   # an empty dump means pg_dump failed silently — make the timer fail loudly

if [ -n "${BACKUP_BUCKET:-}" ]; then
  aws s3 cp --only-show-errors "$OUT/db-$TS.dump" "s3://$BACKUP_BUCKET/daily/db-$TS.dump"
  aws s3 cp --only-show-errors "$OUT/files-$TS.tgz" "s3://$BACKUP_BUCKET/daily/files-$TS.tgz"
fi
find "$OUT" -type f -mtime +7 -delete
echo "backup ok: db-$TS.dump ($(du -h "$OUT/db-$TS.dump" | cut -f1)), files-$TS.tgz ($(du -h "$OUT/files-$TS.tgz" | cut -f1))"
