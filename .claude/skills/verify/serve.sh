#!/bin/sh
# Start, check or stop the local dev server (.devserver.mjs, port 8788) for verification.
# Usage: .claude/skills/verify/serve.sh start|doctor|stop
set -eu
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
STATE=${TMPDIR:-/tmp}/waterchaidantai-verify
PIDFILE=$STATE/devserver.pid
LOG=$STATE/devserver.log
URL=http://127.0.0.1:8788
mkdir -p "$STATE"

ours() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
answering() { curl -s -o /dev/null -m 3 -w '%{http_code}' "$URL/index.html" | grep -q 200; }

case "${1:-}" in
  start)
    if ours; then echo "already running (pid $(cat "$PIDFILE")) at $URL"; exit 0; fi
    if answering; then
      echo "port 8788 is already served by a process this script did not start; refusing to drive it" >&2
      exit 1
    fi
    cd "$REPO" && nohup node .devserver.mjs > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    i=0; until answering; do i=$((i+1)); [ $i -gt 50 ] && { echo "server did not answer; log:" >&2; cat "$LOG" >&2; exit 1; }; sleep 0.1; done
    echo "ready at $URL (pid $(cat "$PIDFILE"))"
    ;;
  doctor)
    ok=1
    if ours; then echo "ok   server process $(cat "$PIDFILE") is ours"; else echo "FAIL no server started by this script (run: serve.sh start)"; ok=0; fi
    if answering; then echo "ok   $URL/index.html answers 200"; else echo "FAIL $URL does not answer"; ok=0; fi
    served=$(curl -s -m 3 "$URL/js/tabbar.js" | head -c 2000 | md5sum | cut -c1-8)
    disk=$(head -c 2000 "$REPO/js/tabbar.js" | md5sum | cut -c1-8)
    if [ "$served" = "$disk" ]; then echo "ok   serving this checkout ($REPO)"; else echo "FAIL served files differ from $REPO"; ok=0; fi
    if [ -x /opt/node22/bin/node ] && [ -d /opt/node22/lib/node_modules/playwright ]; then echo "ok   playwright found"; else echo "WARN playwright not at /opt/node22/lib/node_modules/playwright; set PLAYWRIGHT_MODULE"; fi
    for h in api-v3.thaiwater.net cdn.jsdelivr.net unpkg.com api.open-meteo.com tnvzeahfugmmrydtnsdv.supabase.co tmd-proxy.newusmanwaji.workers.dev; do
      code=$(curl -s -o /dev/null -m 6 -w '%{http_code}' "https://$h/" || true)
      if [ "$code" = 000 ]; then echo "net  $h unreachable (network policy or outage): features using it will show their offline state"; else echo "net  $h reachable ($code)"; fi
    done
    [ $ok = 1 ]
    ;;
  stop)
    if ours; then kill "$(cat "$PIDFILE")" && echo "stopped pid $(cat "$PIDFILE")"; else echo "nothing of ours running"; fi
    rm -f "$PIDFILE"
    ;;
  *) echo "usage: $0 start|doctor|stop" >&2; exit 2 ;;
esac
