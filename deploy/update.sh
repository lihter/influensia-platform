#!/usr/bin/env bash
# Deploy the latest code from GitHub:  sudo /opt/influensia/app/deploy/update.sh
# Pulls main, rebuilds the image, restarts the app (Postgres and the tunnel keep running). Migrations run on app start.
set -euo pipefail
cd "$(dirname "$0")/.."
DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
BEFORE="$(git rev-parse --short HEAD)"
git fetch --quiet origin main && git reset --hard --quiet origin/main   # the server never holds local edits
AFTER="$(git rev-parse --short HEAD)"
echo "code: $BEFORE → $AFTER"
./deploy/backup.sh            # safety copy before every deploy
$DC build app
$DC up -d
docker image prune -f >/dev/null
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT:-3000}/login"; then echo "deploy ok ($AFTER)"; exit 0; fi
  sleep 3
done
echo "app did not come back — check: $DC logs --tail 100 app" >&2; exit 1
