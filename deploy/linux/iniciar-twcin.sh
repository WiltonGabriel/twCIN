#!/usr/bin/env sh
set -eu

BASE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$BASE_DIR"

mkdir -p "$BASE_DIR/data"
if [ ! -f "$BASE_DIR/data/twcin.env" ] && [ -f "$BASE_DIR/config.env.example" ]; then
  cp "$BASE_DIR/config.env.example" "$BASE_DIR/data/twcin.env"
fi

export NODE_ENV=production
export ENV_FILE="$BASE_DIR/data/twcin.env"
export DATA_DIR="$BASE_DIR/data"
export SERVE_FRONTEND=true
export FRONTEND_DIST_DIR="$BASE_DIR/public"
export PORT_AUTO_FALLBACK=true

NODE_BIN="node"
if [ -x "$BASE_DIR/runtime/bin/node" ]; then
  NODE_BIN="$BASE_DIR/runtime/bin/node"
fi

echo "Iniciando twCIN em modo portátil (Ctrl+C para encerrar com segurança)..."
exec "$NODE_BIN" "$BASE_DIR/backend/dist/server.js"
