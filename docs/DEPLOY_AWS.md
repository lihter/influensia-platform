# Deploying Influensia to app.influensia.ro (AWS)

One EC2 server in Frankfurt runs everything in Docker: the app, Postgres 17 and a Cloudflare Tunnel connector.
The server accepts **no inbound connections**; the public reaches it only through Cloudflare, and you reach its
shell only through AWS Session Manager in the browser. Backups go to S3 every night.

```
browser ──https──▶ Cloudflare (app.influensia.ro) ──tunnel──▶ EC2 t4g.small (eu-north-1) 
                                                              ├─ tunnel  (cloudflared, outbound only)
                                                              ├─ app     (Next.js, :3000 on localhost only)
                                                              └─ db      (Postgres 17, internal network only)
                                                              nightly ▶ S3 backup bucket (30 days)
```

| Item | Choice |
|---|---|
| Server | t4g.small (2 vCPU arm64, 2 GB + 4 GB swap), Ubuntu 24.04, 30 GB encrypted gp3 |
| Cost | ~20 USD/month (instance ~14, public IPv4 ~3.65, disk ~2.9, S3 < 0.1), paid from the free-plan credits |
| Data | Postgres volume `influensia_pgdata`, files volume `influensia_appdata` (`/data/files`) |
| Secrets | `/opt/influensia/app/deploy/.env` (root-only, generated on first boot) |
| Accounts | Created once on the empty database by `npm run db:bootstrap`; invite links in SSM `/influensia/invite-links` |

## First release (about 30 minutes of clicks, then ~20 minutes of waiting)

### 1. GitHub — the server pulls the code from here
1. github.com/new → name `influensia-platform`, **Private**, no README → Create.
2. On the Mac, in Terminal:
   ```bash
   cd ~/Developer/Influensia/influensia-platform
   git add -A && git commit -m "Release prep: AWS deployment"
   git remote add origin https://github.com/<you>/influensia-platform.git
   git branch -M main && git push -u origin main
   ```
3. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate:
   repository access **Only select repositories → influensia-platform**, permission **Contents: Read-only**,
   expiration 1 year. Copy the token (`github_pat_…`).

### 2. Cloudflare — connects app.influensia.ro to the server
1. dash.cloudflare.com → **Zero Trust** (first time: pick a team name and the **Free** plan).
2. Networks → **Tunnels** → Create a tunnel → **Cloudflared** → name `influensia` → Save.
3. On the install screen copy the token — the long `eyJ…` string after `--token`. Don't run the command.
4. Next → **Public hostname**: subdomain `app`, domain `influensia.ro`, service type **HTTP**, URL `app:3000` → Save.
   (Cloudflare creates the DNS record itself. The website and Zoho email are untouched.)

### 3. AWS — creates the server
1. Create the AWS account (Free plan). Top-right region selector → **Europe (Stockholm) eu-north-1**.
2. CloudFormation → **Create stack** → *With new resources* → **Upload a template file** →
   `deploy/aws/influensia-stack.yaml` → Next.
3. Stack name `influensia`; fill in: GitHubRepo (`<you>/influensia-platform`), GitHubToken, TunnelToken,
   Leave the rest as is → Next. (Cost alerts: create an AWS Budget in Billing — it is a global service, not part of the stack.)
4. *Stack failure options* → **Preserve successfully provisioned resources** (so a failed first boot can be
   inspected instead of deleted) → tick **I acknowledge that AWS CloudFormation might create IAM resources** → Submit.
5. Wait for **CREATE_COMPLETE** (15–25 min: the server builds the app itself).
6. **Outputs** tab → open **InviteLinks** → *Show decrypted value* → send each person only their own link
   (valid 7 days, single use; each person sets their own password).
7. Open https://app.influensia.ro.

**Free-plan credits:** the account starts with 100 USD; the console home shows activities worth up to 100 USD more
(launching an EC2 instance and creating a budget are two of them — this stack does both). The free plan ends
6 months after sign-up or when credits run out; **upgrade to a paid plan before then or AWS closes the account.**

## Day-to-day

| Task | How |
|---|---|
| Deploy new code | **push to `main`** — GitHub Actions tests, then the server deploys it (see *Automatic deploys*). Manual fallback: Outputs → **ServerShell** → `sudo /opt/influensia/app/deploy/update.sh [commit]` (backs up first, rebuilds, restarts; ~5–10 min) |
| Roll back | GitHub → Actions → an older green run → re-run its **release** job (the server deploys exactly that commit) |
| Invite a new client user | In the app (admin): Clients → the company → add user / **Resend invite**; send the link shown |
| Link expired / forgot password (anyone, incl. agents) | ServerShell → `cd /opt/influensia/app && sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T app npm run -s user:link -- bogdan@influensia.ro` → send the printed link |
| Logs | ServerShell → `cd /opt/influensia/app && sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs --tail 200 app` |
| Backup now | ServerShell → `sudo /opt/influensia/app/deploy/backup.sh` |
| First-boot log | ServerShell → `sudo tail -200 /var/log/influensia-setup.log` |

## Automatic deploys (GitHub Actions + server pull)
`.github/workflows/deploy.yml`, on every push to `main`:
1. **check** — lint, typecheck, unit tests, full Playwright suite on a production build (incl. the anonymity crawl).
   A red check = nothing is released. Pull requests run this job only.
2. **release** — moves the **`production`** branch to the tested commit, then waits until
   `https://app.influensia.ro/api/version` reports that commit (green) or the server gives up (red).
3. **Server** — `influensia-autodeploy.timer` runs `deploy/autodeploy.sh` every minute: when `production` moved, it
   runs `deploy/update.sh <commit>` (backup → build → restart → checks the new container answers with that commit).
   A commit that fails is not retried; push a fix. Log: `journalctl -u influensia-autodeploy -n 100`.

Why pull: the managed AWS rules on this account deny GitHub OIDC (`iam:*OpenIDConnectProvider*`), and AWS keys stored in
GitHub would be a standing risk. With pull, GitHub has no AWS access; the server only reads the repo with its token.
- Typical push → live: ~15–20 min (tests ~8, server build ~5–10).
- Rollback: Actions → an older green run → re-run its **release** job.
- Pause auto-deploys: `sudo systemctl disable --now influensia-autodeploy.timer`; re-enable with
  `sudo /opt/influensia/app/deploy/install-autodeploy.sh` (also installed by host-setup.sh on a new server).
- The server's GitHub token (in `/opt/influensia/app/.git/config`) must stay valid; when it expires, auto-deploys stop
  silently and the release job turns red. Rotate: `git -C /opt/influensia/app remote set-url origin
  https://x-access-token:<NEW>@github.com/lihter/influensia-platform.git`.
- `deploy/aws/influensia-ci.yaml` (push model via OIDC) is kept but not deployable while the SCP blocks OIDC.

> ⚠️ **Do not update the main `influensia` stack casually.** Its `UbuntuAmi` parameter is an SSM path that
> CloudFormation re-resolves on every update; if Canonical has published a newer AMI, the server is **replaced**
> (database and files on the old disk are gone — restore from S3). Put new infrastructure in separate stacks, as
> `influensia-ci` does, or pin `UbuntuAmi` to the current AMI ID first.

## Restore from a backup
```bash
cd /opt/influensia/app && DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
aws s3 ls s3://<BackupBucket>/daily/                      # pick a timestamp
aws s3 cp s3://<BackupBucket>/daily/db-<TS>.dump /tmp/db.dump
aws s3 cp s3://<BackupBucket>/daily/files-<TS>.tgz /tmp/files.tgz
$DC stop app
$DC exec -T db dropdb -U influensia influensia && $DC exec -T db createdb -U influensia influensia
$DC exec -T db pg_restore -U influensia -d influensia --no-owner < /tmp/db.dump
$DC run --rm --no-deps -T --entrypoint sh app -c 'rm -rf /data/files && tar -C /data -xzf -' < /tmp/files.tgz
$DC up -d
```
Tested: dump → restore into a fresh Postgres 17 reproduces users and request lines.

## Known gaps (fine for internal testing)
- **Email is not sent** (no Resend key): invites are delivered by hand; "Forgot password" does not email anyone —
  an admin re-invites instead. Outbox rows accumulate in Ops → Outbox.
- **FX rates start empty**: add a USD→CNY rate in Settings before the first CNY quote. Pricing rules fall back to
  20% uplift / 15% margin / 10% fee until set.
- `piotr@example.pl` is a placeholder address — change it to Piotr's real email before email is switched on.
- Secrets passed to CloudFormation (GitHub token, tunnel token) are readable in the instance user-data by anyone with
  EC2 console access to this AWS account. Both are narrow and revocable (read-only single repo; one tunnel).
