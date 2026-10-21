#!/usr/bin/env bash
# Build + run InfraMatrix as a single unified process on PORT (default 3035), from WSL,
# against Laragon's MySQL on Windows.
#
#   bash deploy/run-local.sh          # build web + api, then start the server
#   bash deploy/run-local.sh --no-build   # just start (use last build)
#
# Notes:
# - The web build is sent to a Linux-fs temp dir first, because Node's copyFileSync
#   throws EPERM when copying into a /mnt/c (Windows drvfs) folder. We then copy the
#   result into apps/web/dist with plain `cp`, which works on drvfs.
# - apps/api/.env must point DB_HOST at the Windows host IP (see below); 127.0.0.1
#   does NOT reach Laragon from WSL2.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3035}"
WINIP="$(ip route show | awk '/default/ {print $3; exit}')"
echo "→ Windows host IP (for DB): ${WINIP}  | PORT=${PORT}"
echo "  (ensure apps/api/.env has DB_HOST=${WINIP})"

if [[ "${1:-}" != "--no-build" ]]; then
  echo "→ Building web UI (via Linux temp dir to dodge drvfs copy bug)…"
  TMP="$(mktemp -d /tmp/web-dist.XXXXXX)"
  ( cd apps/web && npx vite build --outDir "$TMP" --emptyOutDir )
  rm -rf apps/web/dist && mkdir -p apps/web/dist && cp -r "$TMP"/. apps/web/dist/
  rm -rf "$TMP"

  echo "→ Building API…"
  npm run api:build
fi

echo "→ Starting unified server on http://127.0.0.1:${PORT}  (UI: /  API: /api/v1)"
cd apps/api && PORT="$PORT" exec node dist/main
