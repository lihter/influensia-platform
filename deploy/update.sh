#!/usr/bin/env bash
# Deploy code from GitHub:  sudo /opt/influensia/app/deploy/update.sh [commit]
# No argument = latest main. deploy/autodeploy.sh (every minute) passes the commit GitHub Actions marked as
# `production` after the tests passed. The commit must be on main (an older one = rollback). Rebuilds the image,
# restarts the app (Postgres and the tunnel keep running). Migrations run on app start.
set -euo pipefail
cd "$(dirname "$0")/.."
exec 9>/run/influensia-deploy.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }
DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
BEFORE="$(git rev-parse --short HEAD)"
REF="${1:-origin/main}"
git fetch --quiet origin main
git cat-file -e "${REF}^{commit}" 2>/dev/null || { echo "unknown commit: $REF" >&2; exit 1; }
git merge-base --is-ancestor "$REF" origin/main || { echo "$REF is not on main" >&2; exit 1; }
git reset --hard --quiet "$REF"   # the server never holds local edits
AFTER="$(git rev-parse --short HEAD)"
echo "code: $BEFORE → $AFTER"
./deploy/backup.sh            # safety copy before every deploy
$DC build --build-arg GIT_SHA="$(git rev-parse HEAD)" app
$DC up -d
docker image prune -f >/dev/null
SHA="$(git rev-parse HEAD)"
for _ in $(seq 1 40); do   # the NEW container must answer with this commit (not the old one still stopping)
  if curl -fsS "http://127.0.0.1:${APP_PORT:-3000}/api/version" 2>/dev/null | grep -q "$SHA" \
     && curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT:-3000}/login"; then
    mkdir -p /var/lib/influensia && echo "$SHA" > /var/lib/influensia/deployed-sha
    echo "deploy ok ($AFTER)"; exit 0
  fi
  sleep 3
done
echo "app did not come back — check: $DC logs --tail 100 app" >&2; exit 1
