#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root (ex.: sudo ./desinstalar-linux.sh)." >&2
  exit 1
fi

PURGE_DATA="${1:-}"
APP_DIR="/opt/twcin"
DATA_DIR="/var/lib/twcin"

if systemctl is-active --quiet twcin.service 2>/dev/null; then
  systemctl stop twcin.service
fi
if systemctl is-enabled --quiet twcin.service 2>/dev/null; then
  systemctl disable twcin.service
fi
if [ -f /etc/systemd/system/twcin.service ]; then
  rm -f /etc/systemd/system/twcin.service
  systemctl daemon-reload
fi

rm -rf "$APP_DIR"
echo "Serviço e arquivos do programa removidos."

if [ "$PURGE_DATA" = "--purge-data" ]; then
  rm -rf "$DATA_DIR"
  echo "Dados removidos de $DATA_DIR."
else
  echo "Dados preservados em $DATA_DIR (passe --purge-data para apagar)."
fi
