#!/usr/bin/env bash
# Cópia diária do que não dá para recriar: a configuração que o médico montou
# pelo painel e a sessão do WhatsApp. Guarda 30 dias.
#
# No cron:  10 3 * * *  /caminho/app/deploy/backup-config.sh
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="${BACKUP_DIR:-$HOME/backups/agendamento}"
CARIMBO="$(date +%Y-%m-%d)"

mkdir -p "$DESTINO"

if [ -f "$APP/dados/config.json" ]; then
  cp "$APP/dados/config.json" "$DESTINO/config-$CARIMBO.json"
fi

if [ -d "$APP/wwebjs_auth" ]; then
  tar czf "$DESTINO/whatsapp-$CARIMBO.tar.gz" -C "$APP" wwebjs_auth
fi

# some com o que passou de 30 dias
find "$DESTINO" -type f -mtime +30 -delete

echo "$(date '+%F %T') backup em $DESTINO"
