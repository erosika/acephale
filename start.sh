#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# --- Preflight ---

if [ ! -f .env ]; then
  echo "[start] No .env found. Copy .env.example and set GEMINI_API_KEY."
  exit 1
fi

source .env

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "[start] GEMINI_API_KEY is not set in .env"
  exit 1
fi

# Create required directories
mkdir -p sources episodes tracks archive .tmp

# --- Install deps ---
bun install --frozen-lockfile 2>/dev/null || bun install

# --- Docker stack ---
echo "[start] Starting Icecast + Liquidsoap..."
docker compose up -d

# Wait for Icecast to accept connections
echo "[start] Waiting for Icecast..."
for i in $(seq 1 15); do
  if curl -s http://localhost:8000/status-json.xsl >/dev/null 2>&1; then
    echo "[start] Icecast is up"
    break
  fi
  sleep 1
done

# --- Station selection ---
STATION="${1:-crate}"

echo "[start] Starting server on port ${PORT:-3131}..."
bun run src/server/index.ts &
SERVER_PID=$!

sleep 1

echo "[start] Starting station: $STATION"
case "$STATION" in
  zoo)       bun run src/stations/morning-zoo/loop.ts & ;;
  crate)     bun run src/stations/crate-digger/loop.ts & ;;
  conspiracy) bun run src/stations/conspiracy-hour/loop.ts & ;;
  request)   bun run src/stations/request-line/loop.ts & ;;
  all)
    bun run src/stations/morning-zoo/loop.ts &
    bun run src/stations/crate-digger/loop.ts &
    bun run src/stations/conspiracy-hour/loop.ts &
    bun run src/stations/request-line/loop.ts &
    ;;
  *)
    echo "[start] Unknown station: $STATION"
    echo "Usage: ./start.sh [zoo|crate|conspiracy|request|all]"
    kill $SERVER_PID 2>/dev/null
    exit 1
    ;;
esac

STATION_PID=$!

echo ""
echo "==================================="
echo "  ACEPHALE RADIO"
echo "==================================="
echo "  Player:  http://localhost:${PORT:-3131}"
echo "  API:     http://localhost:${PORT:-3131}/health"
echo "  Icecast: http://localhost:8000"
echo "  Station: $STATION"
echo ""
echo "  Press Ctrl+C to stop"
echo "==================================="

# Cleanup on exit
trap 'echo "[start] Shutting down..."; kill $SERVER_PID $STATION_PID 2>/dev/null; docker compose down; exit 0' INT TERM

wait
