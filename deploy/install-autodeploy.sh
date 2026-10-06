#!/usr/bin/env bash
# Installs/updates the every-minute auto-deploy timer. Idempotent. Run as root on the server:
#   sudo /opt/influensia/app/deploy/install-autodeploy.sh
# Disable: sudo systemctl disable --now influensia-autodeploy.timer
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cat > /etc/systemd/system/influensia-autodeploy.service <<UNIT
[Unit]
Description=Influensia auto-deploy (deploys the GitHub production branch when it moves)
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
ExecStart=${REPO}/deploy/autodeploy.sh
TimeoutStartSec=45min
UNIT
cat > /etc/systemd/system/influensia-autodeploy.timer <<UNIT
[Unit]
Description=Check for a new Influensia release every minute
[Timer]
OnBootSec=2min
OnUnitInactiveSec=1min
AccuracySec=10s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now influensia-autodeploy.timer
systemctl list-timers influensia-autodeploy.timer --no-pager | head -3
