#!/usr/bin/env bash
# Pull-based auto-deploy — run every minute by influensia-autodeploy.timer (deploy/install-autodeploy.sh).
# GitHub Actions moves the `production` branch to a main commit only after the full test suite passed on it; this
# deploys that commit. The server needs no inbound access and GitHub needs no AWS access.
# A commit that failed to deploy is not retried (no backup/build loop) — push a fix, or run update.sh by hand.
# Log: journalctl -u influensia-autodeploy -n 100
set -euo pipefail
cd "$(dirname "$0")/.."
STATE=/var/lib/influensia
mkdir -p "$STATE"
# no production branch yet, or GitHub unreachable / token expired → try again next minute
git fetch --quiet origin +refs/heads/production:refs/remotes/origin/production || exit 0
TARGET="$(git rev-parse origin/production)"
[ "$TARGET" = "$(cat "$STATE/deployed-sha" 2>/dev/null || true)" ] && exit 0
[ "$TARGET" = "$(cat "$STATE/failed-sha" 2>/dev/null || true)" ] && exit 0
flock -n /run/influensia-deploy.lock true || exit 0   # a manual deploy is running — wait for it
echo "deploying production ${TARGET:0:7}"
if ./deploy/update.sh "$TARGET"; then
  rm -f "$STATE/failed-sha"
else
  echo "$TARGET" > "$STATE/failed-sha"
  echo "deploy of ${TARGET:0:7} FAILED — not retrying this commit" >&2
  exit 1
fi
