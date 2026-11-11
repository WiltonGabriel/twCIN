#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root (ex.: sudo ./instalar-linux.sh)." >&2
  exit 1
fi

SRC_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="/opt/twcin"
DATA_DIR="/var/lib/twcin"
EXPLICIT_PORT="${TWCIN_PORT:-}"
PORT_NUM="${EXPLICIT_PORT:-3333}"

if ! id twcin >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin twcin 2>/dev/null || adduser --system --no-create-home twcin
fi

if systemctl is-active --quiet twcin.service 2>/dev/null; then
  echo "Parando serviço twcin.service para atualizar..."
  systemctl stop twcin.service
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$DATA_DIR/backups"

# Preserva porta já configurada em twcin.env quando TWCIN_PORT não for informada explicitamente.
if [ -f "$DATA_DIR/twcin.env" ]; then
  if [ -n "$EXPLICIT_PORT" ]; then
    if grep -q '^PORT=' "$DATA_DIR/twcin.env"; then
      sed -i "s/^PORT=.*/PORT=$PORT_NUM/" "$DATA_DIR/twcin.env"
    else
      printf 'PORT=%s\n%s\n' "$PORT_NUM" "$(cat "$DATA_DIR/twcin.env")" > "$DATA_DIR/twcin.env"
    fi
  else
    EXISTING_PORT="$(grep -E '^PORT=[0-9]+' "$DATA_DIR/twcin.env" | head -n 1 | cut -d= -f2 || true)"
    if [ -n "$EXISTING_PORT" ]; then
      PORT_NUM="$EXISTING_PORT"
    fi
  fi
elif [ -f "$SRC_DIR/config.env.example" ]; then
  sed "s/^PORT=3333$/PORT=$PORT_NUM/" "$SRC_DIR/config.env.example" > "$DATA_DIR/twcin.env"
else
  printf 'PORT=%s\nHOST=0.0.0.0\nSERVE_FRONTEND=true\n' "$PORT_NUM" > "$DATA_DIR/twcin.env"
fi

NODE_BIN="$(command -v node || true)"
if [ -x "$SRC_DIR/runtime/bin/node" ]; then
  NODE_BIN="$SRC_DIR/runtime/bin/node"
elif [ -x "$APP_DIR/runtime/bin/node" ]; then
  NODE_BIN="$APP_DIR/runtime/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  echo "Node.js 24+ não encontrado." >&2
  exit 1
fi

# Pré-checagem da porta TCP antes de copiar/habilitar o serviço (evita loop de erro no boot).
"$NODE_BIN" -e '
const net = require("node:net");
const port = Number(process.argv[1]);
const test = (p) => new Promise((res) => {
  const s = net.createServer();
  s.once("error", () => res(false));
  s.listen(p, "0.0.0.0", () => s.close(() => res(true)));
});
(async () => {
  if (await test(port)) process.exit(0);
  let next = port + 1;
  while (next <= 65535 && !(await test(next))) next++;
  console.error(`ERRO: A porta TCP ${port} já está em uso por outro programa. Execute com outra porta livre, ex.: TWCIN_PORT=${next} sudo -E ./instalar-linux.sh`);
  process.exit(1);
})();
' "$PORT_NUM"

for dir in backend public runtime docs; do
  if [ -d "$SRC_DIR/$dir" ]; then
    rm -rf "$APP_DIR/$dir"
    cp -a "$SRC_DIR/$dir" "$APP_DIR/$dir"
  fi
done
for f in config.env.example iniciar-twcin.sh README.md CHANGELOG.md LICENSE; do
  if [ -f "$SRC_DIR/$f" ]; then
    cp -f "$SRC_DIR/$f" "$APP_DIR/$f"
  fi
done

if [ -x "$APP_DIR/runtime/bin/node" ]; then
  NODE_BIN="$APP_DIR/runtime/bin/node"
fi

chown -R root:root "$APP_DIR"
chown -R twcin:twcin "$DATA_DIR"
chmod 750 "$DATA_DIR"
chmod 600 "$DATA_DIR/twcin.env"

cat > /etc/systemd/system/twcin.service <<EOF
[Unit]
Description=twCIN - Gestão Interna de TI
After=network.target

[Service]
Type=simple
User=twcin
Group=twcin
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=ENV_FILE=$DATA_DIR/twcin.env
Environment=DATA_DIR=$DATA_DIR
Environment=SERVE_FRONTEND=true
Environment=FRONTEND_DIST_DIR=$APP_DIR/public
ExecStart=$NODE_BIN $APP_DIR/backend/dist/server.js
Restart=always
RestartSec=5
TimeoutStopSec=12
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now twcin.service

echo ""
echo "twCIN instalado e ativo em systemd (twcin.service)!"
echo "  Programa : $APP_DIR"
echo "  Dados    : $DATA_DIR (banco, twcin.env, backups)"
echo "  URL      : http://localhost:$PORT_NUM"
echo "  Controle : sudo systemctl stop|restart|status twcin"
