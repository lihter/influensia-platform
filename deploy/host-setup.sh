#!/usr/bin/env bash
# First-boot setup of an Ubuntu 24.04 server (run as root by the CloudFormation user-data; safe to re-run).
#   APP_URL=https://app.influensia.ro TUNNEL_TOKEN=… [BACKUP_BUCKET=…] [INVITES_PARAM=/influensia/invite-links] [AWS_REGION=…] \
#     ./deploy/host-setup.sh
# Installs Docker, adds swap, writes deploy/.env (secrets generated once, kept on re-runs), builds + starts the stack,
# creates the 4 accounts on an empty database and stores their invite links in SSM Parameter Store, installs the
# nightly backup timer.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
: "${APP_URL:?APP_URL required}" "${TUNNEL_TOKEN:?TUNNEL_TOKEN required}"
export DEBIAN_FRONTEND=noninteractive PATH="$PATH:/snap/bin"

echo "== swap (the 2 GB instance needs it to build Next.js)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== packages"
apt-get update -y
apt-get install -y docker.io docker-compose-v2 docker-buildx git curl
systemctl enable --now docker
command -v aws >/dev/null || snap install aws-cli --classic

echo "== deploy/.env"
if [ ! -f deploy/.env ]; then
  umask 077
  cat > deploy/.env <<EOF
APP_URL=${APP_URL}
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 24)
CRON_SECRET=$(openssl rand -hex 24)
TUNNEL_TOKEN=${TUNNEL_TOKEN}
BACKUP_BUCKET=${BACKUP_BUCKET:-}
AUTH_IP_HEADERS=cf-connecting-ip
COMPOSE_PROFILES=tunnel
EOF
fi
chmod 600 deploy/.env
DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"

echo "== build + start (first build takes ~10 min on t4g.small)"
$DC build --build-arg GIT_SHA="$(git rev-parse HEAD)" app
$DC up -d
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:3000/login && break; sleep 5; done
curl -fsS -o /dev/null http://127.0.0.1:3000/login

echo "== accounts (only on an empty database)"
if $DC exec -T app npm run -s db:bootstrap > /root/influensia-invites.txt 2> /root/influensia-bootstrap.err; then
  chmod 600 /root/influensia-invites.txt
  if [ -n "${INVITES_PARAM:-}" ]; then
    aws ssm put-parameter --region "${AWS_REGION:?}" --name "$INVITES_PARAM" --type SecureString --overwrite \
      --value "file:///root/influensia-invites.txt" >/dev/null && echo "invite links stored in SSM $INVITES_PARAM"
  fi
else
  if grep -q "refusing" /root/influensia-bootstrap.err; then echo "accounts already exist — skipped"; else cat /root/influensia-bootstrap.err; exit 1; fi
fi

echo "== nightly backup timer (02:30 UTC)"
cat > /etc/systemd/system/influensia-backup.service <<EOF
[Unit]
Description=Influensia backup (Postgres + files → S3)
After=docker.service
[Service]
Type=oneshot
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
ExecStart=${REPO}/deploy/backup.sh
EOF
cat > /etc/systemd/system/influensia-backup.timer <<EOF
[Unit]
Description=Nightly Influensia backup
[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now influensia-backup.timer
"${REPO}/deploy/backup.sh"
mkdir -p /var/lib/influensia && git rev-parse HEAD > /var/lib/influensia/deployed-sha

echo "== auto-deploy timer (deploys the GitHub production branch when it moves)"
"${REPO}/deploy/install-autodeploy.sh"

echo "== done: $APP_URL"
