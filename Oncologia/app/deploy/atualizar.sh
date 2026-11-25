#!/usr/bin/env bash
#
# Atualiza o código na VPS a partir do GitHub, sem encostar no que é do
# consultório: configuração, credenciais, foto e sessão do WhatsApp.
#
#   ~/agendamento-src/   clone do repositório (só código, descartável)
#   ~/agendamento-onco/  o que está no ar
#
# Uso:  ./deploy/atualizar.sh [branch]
#
set -euo pipefail

BRANCH="${1:-main}"
FONTE="$HOME/agendamento-src"
DESTINO="$HOME/agendamento-onco/app"
REPO="https://github.com/rrabadan86/M-dico-Agendamento.git"

[ -d "$DESTINO" ] || { echo "não achei $DESTINO"; exit 1; }

if [ -d "$FONTE/.git" ]; then
  git -C "$FONTE" fetch origin "$BRANCH"
  git -C "$FONTE" checkout "$BRANCH"
  git -C "$FONTE" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$FONTE"
fi

echo "==> commit: $(git -C "$FONTE" log --oneline -1)"

# guarda o lockfile de antes: só reinstala se ele tiver mudado (ver abaixo)
LOCK_ANTES=""
[ -f "$DESTINO/package-lock.json" ] && LOCK_ANTES=$(sha1sum < "$DESTINO/package-lock.json")

# cópia de segurança da configuração antes de mexer em qualquer coisa
if [ -f "$DESTINO/dados/config.json" ]; then
  cp "$DESTINO/dados/config.json" "$HOME/config-backup-$(date +%F-%H%M).json"
fi

# --delete limpa arquivo que saiu do repositório; os excludes são o que a
# atualização nunca pode tocar — sem eles, um deploy derruba o WhatsApp.
rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude 'credenciais.json' \
  --exclude 'wwebjs_auth/' \
  --exclude '.wwebjs_cache/' \
  --exclude 'dados/' \
  --exclude 'logs/' \
  "$FONTE/app/" "$DESTINO/"

cd "$DESTINO"

# `npm ci` apaga o node_modules inteiro, e junto vai o Chromium que o
# Puppeteer baixou para o WhatsApp — são minutos de download e uma chance de
# falhar com o site fora do ar. Como a maioria das atualizações não mexe em
# dependência, só reinstala quando o lockfile realmente mudou.
LOCK_DEPOIS=$(sha1sum < package-lock.json)
if [ "$LOCK_ANTES" != "$LOCK_DEPOIS" ]; then
  echo "==> dependências mudaram: reinstalando"
  npm ci --omit=dev
else
  echo "==> dependências iguais: pulando npm ci"
fi

npm test
pm2 restart agendamento-onco

echo "==> pronto"
