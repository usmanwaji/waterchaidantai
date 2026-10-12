#!/usr/bin/env bash
# setup-live.sh - install telerid live mode on a Linux server in Thailand (Ubuntu/Debian), e.g. AWS Bangkok
# Usage (on the server):
#   curl -fsSL https://raw.githubusercontent.com/usmanwaji/waterchaidantai/main/telerid-scraper/setup-live.sh -o setup-live.sh
#   sudo bash setup-live.sh
# Runs live mode as a systemd service (starts at boot, restarts on crash). Safe to run again to update.
set -euo pipefail
REPO=usmanwaji/waterchaidantai
BRANCH="${TELERID_SETUP_BRANCH:-main}"
DIR=/opt/telerid-live
SVC=telerid-live
ENVF=/etc/telerid-live.env
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo bash $0"; exit 1; }
step(){ echo; echo "== $*"; }

step "1/7 Can this server reach telerid? (it blocks non-Thai IPs)"
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' https://telerid.rid.go.th/restapi/main/station_list/ || true)
echo "   telerid answered HTTP $code"
if [ "$code" != 200 ]; then
  echo "   !! telerid did not answer 200 - this server is probably blocked."
  read -rp "   Continue anyway? (y/n) " a; [[ "$a" =~ ^[yY] ]] || exit 1
fi

step "2/7 Memory (Chromium needs about 1.5 GB)"
mem=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
if [ "$mem" -lt 1800 ] && ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "   added 2 GB swap (RAM ${mem} MB)"
else echo "   RAM ${mem} MB ok"; fi

step "3/7 Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   node $(node -v)"

step "4/7 Download scraper files ($BRANCH)"
mkdir -p "$DIR"; tmp=$(mktemp -d)
for f in scrape.mjs publish-github.mjs package.json; do
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$BRANCH/telerid-scraper/$f?t=$(date +%s)" -o "$tmp/$f"
done
cp "$tmp"/* "$DIR"/ && rm -rf "$tmp"; echo "   -> $DIR"

step "5/7 Packages + Chromium (first time 2-5 minutes)"
cd "$DIR"
npm install --no-audit --no-fund --silent
npx --yes playwright install --with-deps chromium >/dev/null
echo "   ready"

step "6/7 GitHub token"
tok=""; [ -f "$ENVF" ] && tok=$(sed -n 's/^GH_TOKEN=//p' "$ENVF")
for i in 1 2 3; do
  if [ -z "$tok" ]; then read -rsp "   Paste GitHub token (github_pat_...): " tok; echo; fi
  c=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tok" "https://api.github.com/repos/$REPO/branches/main")
  [ "$c" = 200 ] && break; echo "   !! GitHub rejected the token (HTTP $c)"; tok=""
done
[ -n "$tok" ] || { echo "No working token"; exit 1; }
umask 077; printf 'GH_TOKEN=%s\n' "$tok" > "$ENVF"; echo "   saved to $ENVF"

step "7/7 Service"
cat > /etc/systemd/system/$SVC.service <<UNIT
[Unit]
Description=naraflood telerid live scraper
After=network-online.target
Wants=network-online.target
[Service]
WorkingDirectory=$DIR
EnvironmentFile=$ENVF
Environment=HOME=/root
ExecStartPre=/bin/rm -f $DIR/telerid-live.lock
ExecStart=$(command -v node) scrape.mjs --watch
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
start=$( [ -f "$DIR/telerid-live.log" ] && wc -l < "$DIR/telerid-live.log" || echo 0 )
systemctl enable --now $SVC >/dev/null 2>&1; systemctl restart $SVC
echo "   waiting for the first round (up to 3 minutes)..."
for i in $(seq 1 90); do
  sleep 2
  line=$(tail -n +$((start+1)) "$DIR/telerid-live.log" 2>/dev/null | grep -E '\[(sent|no change|error)\]' | head -1 || true)
  [ -n "$line" ] && break
done
echo; echo "   ${line:-no result yet - check: journalctl -u $SVC -n 30}"
echo
echo "Done. Log: tail -f $DIR/telerid-live.log   Status: systemctl status $SVC   Stop: sudo systemctl disable --now $SVC"
