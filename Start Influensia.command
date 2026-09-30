#!/bin/zsh
# Influensia Sourcing Platform — one-click local start (macOS).
# Double-click in Finder. First run: installs dependencies, creates .env.local, seeds demo data.
# Later runs: just starts the app. To reset demo data: run with --reseed, or delete the .data folder.
set -e
cd "$(dirname "$0")"
PORT=3000

# Load the user's shell setup so node/npm from Homebrew, nvm, fnm or volta are on PATH
[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile" >/dev/null 2>&1 || true
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" >/dev/null 2>&1 || true
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "── Influensia Sourcing Platform ──────────────────────────"
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js not found — installing Node 22 with Homebrew…"
    brew install node@22 && brew link --overwrite --force node@22
  else
    echo "Node.js 22+ is required. Install it from https://nodejs.org (LTS), then double-click this file again."
    open "https://nodejs.org/en/download"; read -k1 "?Press any key to close…"; exit 1
  fi
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
echo "Node $(node -v) · npm $(npm -v)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node 22 or newer is required (you have $(node -v))."
  if command -v brew >/dev/null 2>&1; then brew install node@22 && brew link --overwrite --force node@22; hash -r; else open "https://nodejs.org/en/download"; read -k1 "?Press any key to close…"; exit 1; fi
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "Installing dependencies (first run, ~1–3 min)…"
  npm ci --no-audit --no-fund || npx --yes npm@latest install --no-audit --no-fund
fi

if [ ! -f .env.local ]; then
  echo "Creating .env.local…"
  SECRET=$(openssl rand -hex 32)
  sed -e "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=http://localhost:$PORT|" \
      -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$SECRET|" .env.example > .env.local
fi

if [ ! -d .data/pglite ] || [ "$1" = "--reseed" ]; then
  echo "Seeding demo data (dated relative to today)…"
  npm run db:seed
fi

# Use the first free port from 3000 up — never stop another app that is already using a port
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  echo "Port $PORT is in use by another app — trying $((PORT+1))…"; PORT=$((PORT+1))
done
export BETTER_AUTH_URL="http://localhost:$PORT"   # must match the port we serve on

cat <<INFO

  App:      http://localhost:$PORT   (first page load compiles for ~10–20 s)
  Password: Password123!
    piotr@example.pl        client
    buyer@koff.example      client
    bogdan@influensia.ro    agent
    cristina@influensia.ro  agent
    marko@influensia.ro     admin
  Stop:     close this window or press Ctrl+C
  Reset demo data: delete the .data folder, then double-click again

INFO
( sleep 6; open "http://localhost:$PORT/login" ) &
exec npm run dev -- -p $PORT
