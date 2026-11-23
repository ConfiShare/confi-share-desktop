#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This smoke check requires macOS." >&2
  exit 1
fi

ELECTRON="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$ELECTRON" ] || [ ! -f "dist-electron/main.js" ] || [ ! -f "dist/index.html" ]; then
  echo "The compiled Electron app is missing." >&2
  exit 1
fi

PORT=19222
LOG="$(mktemp)"
PAGES="$(mktemp)"
cleanup() {
  kill "$APP_PID" 2>/dev/null || true
  rm -f "$LOG" "$PAGES"
}
trap cleanup EXIT

"$ELECTRON" . --remote-debugging-port="$PORT" > "$LOG" 2>&1 &
APP_PID=$!

READY=0
for _ in $(seq 1 45); do
  if curl --silent --fail "http://127.0.0.1:$PORT/json/list" > "$PAGES"; then
    if node -e 'const pages=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (!Array.isArray(pages) || !pages.some(p => p.type === "page" && p.url.startsWith("file://") && /ConfiShare/i.test(p.title || ""))) process.exit(1)' "$PAGES" 2>/dev/null; then
      READY=1
      break
    fi
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "Electron did not open the compiled renderer on macOS." >&2
  cat "$LOG" >&2
  exit 1
fi

echo "Compiled renderer opened in Electron on macOS."
node -e 'const pages=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); for (const p of pages.filter(p => p.type === "page")) console.log(`Page: ${p.title} ${p.url}`)' "$PAGES"
