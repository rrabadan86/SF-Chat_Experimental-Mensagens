#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Instala (ou reinstala) o PAINEL DE DEMONSTRAÇÃO com dados fictícios.
#
#   bash /root/SF-Chat_Experimental-Mensagens/scripts/instalar-demo.sh painelslimfit.duckdns.org
#
# O que faz (pode rodar de novo sem problema):
#   1. clona o repositório em /root/slimfit-exemplo (pasta SEPARADA da unidade real);
#   2. instala as dependências do painel (sem baixar navegador);
#   3. cria o .env da demonstração (PAINEL_DEMO=1, porta própria, SoFIA fictícia);
#   4. gera os dados fictícios e sobe o processo "exemplo-painel" no PM2;
#   5. agenda a renovação dos dados a cada 15 minutos (cron);
#   6. acrescenta o domínio no Caddy (HTTPS automático) e recarrega.
#
# A demonstração NÃO toca na unidade real: outra pasta, outros dados, e o modo
# demonstração bloqueia comandos, rede de saída e todas as ações do painel.
# Ela é atualizada junto com as outras pelo slimfit-atualizar (mesmo repositório).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOM="${1:-painelslimfit.duckdns.org}"
PORTA="${DEMO_PORTA:-8095}"
DESTINO="${DEMO_DIR:-/root/slimfit-exemplo}"
ORIGEM="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(git -C "$ORIGEM" remote get-url origin)"
NOME_PM2="exemplo-painel"

echo "🎭 Painel de demonstração → https://$DOM (porta interna $PORTA, pasta $DESTINO)"

# 1. código
if [ -d "$DESTINO/.git" ]; then
  echo "   ✔ pasta já existe — atualizando o código"
  git -C "$DESTINO" fetch -q origin main && git -C "$DESTINO" reset -q --hard origin/main
else
  git clone -q "$REPO" "$DESTINO"
  echo "   ✔ repositório clonado"
fi
cd "$DESTINO/Experimental"

# 2. dependências (sem baixar o Chromium do puppeteer: o painel não usa)
PUPPETEER_SKIP_DOWNLOAD=1 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund --loglevel=error
echo "   ✔ dependências instaladas"

# 3. .env da demonstração (recriado sempre: nada de credencial real aqui)
mkdir -p "$DESTINO/sofia-demo"
cat > .env <<EOF
# Painel de DEMONSTRAÇÃO — dados fictícios. Não coloque credenciais reais aqui.
PAINEL_DEMO=1
PAINEL_PORT=$PORTA
PAINEL_HOST=127.0.0.1
PM2_SLUG=exemplo
SOFIA_DIR=$DESTINO/sofia-demo
STUDIO_NOME=Studio SlimFit Demonstração
EOF
echo "   ✔ .env da demonstração criado"

# 4. dados fictícios + processo no PM2
node src/demo-dados.js
if pm2 describe "$NOME_PM2" >/dev/null 2>&1; then
  pm2 restart "$NOME_PM2" --update-env >/dev/null
else
  pm2 start src/painel-mensagens.js --name "$NOME_PM2" --cwd "$DESTINO/Experimental" --time >/dev/null
fi
pm2 save >/dev/null
echo "   ✔ processo $NOME_PM2 no ar"

# 5. renovação dos dados a cada 15 min
LINHA="*/15 * * * * cd $DESTINO/Experimental && node src/demo-dados.js >/dev/null 2>&1"
( crontab -l 2>/dev/null | grep -vF "src/demo-dados.js" ; echo "$LINHA" ) | crontab -
echo "   ✔ renovação dos dados agendada (a cada 15 min)"

# 6. Caddy
if [ -f /etc/caddy/Caddyfile ]; then
  if grep -qF "$DOM" /etc/caddy/Caddyfile; then
    echo "   ✔ $DOM já está no Caddy"
  else
    printf '\n# --- demonstração (SlimFit, dados fictícios) ---\n%s {\n    encode gzip\n    reverse_proxy 127.0.0.1:%s\n}\n' "$DOM" "$PORTA" >> /etc/caddy/Caddyfile
    echo "   ✔ $DOM acrescentado ao Caddy"
  fi
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  echo "   ✔ Caddy recarregado"
else
  echo "   ⚠️  /etc/caddy/Caddyfile não encontrado — aponte $DOM para 127.0.0.1:$PORTA no seu proxy."
fi

sleep 2
if curl -fsS -o /dev/null "http://127.0.0.1:$PORTA/hoje"; then
  echo "✅ Pronto. Abra https://$DOM (o HTTPS sai sozinho assim que o DNS do duckdns apontar para este servidor)."
else
  echo "⚠️  O painel não respondeu na porta $PORTA — veja: pm2 logs $NOME_PM2 --lines 40"
fi
