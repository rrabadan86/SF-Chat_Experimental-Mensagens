#!/usr/bin/env bash
# ============================================================================
#  setup-novo-studio.sh — Provisiona UMA instância do sistema SlimFit num VPS
#  novo (modelo "um studio por VPS"). Não mexe em nada que já exista: só
#  instala dependências, cria as pastas de dados, monta os .env a partir dos
#  modelos (gerando segredos aleatórios) e — na fase --start — sobe o PM2.
#
#  USO (rode DE DENTRO da pasta Experimental/, após o git clone):
#    1) Fase de preparação (instala + monta os .env com segredos):
#         bash setup-novo-studio.sh --slug lagosul --studio "Studio SlimFit Lago Sul"
#    2) Edite os .env que ele apontar (EVO, ANTHROPIC_API_KEY, formulário…).
#    3) Fase de subida (liga os processos no PM2):
#         bash setup-novo-studio.sh --slug lagosul --start
#
#  Segurança: os .env NUNCA vão para o Git (estão no .gitignore). Este script
#  só ESCREVE .env se ele ainda não existir — nunca sobrescreve o seu.
# ============================================================================
set -euo pipefail

# ---- argumentos -----------------------------------------------------------
SLUG=""            # identificador curto do studio (nomes dos processos PM2)
STUDIO_NOME=""     # nome como aparece para a aluna
START=0            # --start liga os processos no PM2
while [ $# -gt 0 ]; do
  case "$1" in
    --slug)   SLUG="${2:-}"; shift 2 ;;
    --studio) STUDIO_NOME="${2:-}"; shift 2 ;;
    --start)  START=1; shift ;;
    -h|--help)
      grep -E '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Argumento desconhecido: $1"; exit 1 ;;
  esac
done

[ -n "$SLUG" ] || { echo "❌ Faltou --slug (ex.: --slug lagosul)"; exit 1; }
echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]{1,30}$' \
  || { echo "❌ --slug deve ser minúsculo, sem espaço/acento (ex.: lagosul)"; exit 1; }

# ---- caminhos -------------------------------------------------------------
EXP_DIR="$(cd "$(dirname "$0")" && pwd)"     # .../Experimental
REPO_DIR="$(cd "$EXP_DIR/.." && pwd)"        # raiz do repositório
CHATBOT_DIR="$REPO_DIR/ChatBot"
SOFIA_DIR="${SOFIA_DIR:-$HOME/sofia-data-$SLUG}"   # dados vivos, FORA do repo

P_PAINEL="${SLUG}-painel"
P_EXP="${SLUG}-exp"
P_SOFIA="${SLUG}-sofia"

echo "──────────────────────────────────────────────────────────"
echo "  Studio: ${STUDIO_NOME:-($SLUG)}"
echo "  Repo:      $REPO_DIR"
echo "  SOFIA_DIR: $SOFIA_DIR"
echo "  Processos: $P_PAINEL · $P_EXP · $P_SOFIA"
echo "──────────────────────────────────────────────────────────"

# gera um segredo aleatório (openssl, senão node)
segredo() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"; fi
}

# ==========================================================================
#  FASE --start: só liga os processos (assume .env já preenchidos)
# ==========================================================================
if [ "$START" = "1" ]; then
  command -v pm2 >/dev/null 2>&1 || { echo "❌ pm2 não encontrado. Instale: npm i -g pm2"; exit 1; }
  [ -f "$EXP_DIR/.env" ]     || { echo "❌ $EXP_DIR/.env não existe — rode a fase de preparação antes."; exit 1; }
  [ -f "$CHATBOT_DIR/.env" ] || { echo "❌ $CHATBOT_DIR/.env não existe — rode a fase de preparação antes."; exit 1; }

  echo "▶️  Subindo/reiniciando os processos no PM2…"
  # Painel (porta do .env; Caddy faz o HTTPS por cima)
  pm2 delete "$P_PAINEL" >/dev/null 2>&1 || true
  ( cd "$EXP_DIR" && pm2 start src/painel-mensagens.js --name "$P_PAINEL" --time )
  # Agendador do robô (confirmações, follow-ups, push_slots, backup)
  pm2 delete "$P_EXP" >/dev/null 2>&1 || true
  ( cd "$EXP_DIR" && pm2 start src/scheduler.js --name "$P_EXP" --time )
  # SoFIA (chatbot no WhatsApp) — roda .ts via tsx
  pm2 delete "$P_SOFIA" >/dev/null 2>&1 || true
  ( cd "$CHATBOT_DIR" && pm2 start "npx tsx sofia-listener.ts" --name "$P_SOFIA" --time )

  pm2 save
  echo
  echo "✅ Processos no ar. Próximos passos:"
  echo "   • Leia os QRs dos 2 WhatsApp:  pm2 logs $P_EXP   e   pm2 logs $P_SOFIA"
  echo "   • Configure o HTTPS (Caddy/reverse-proxy) para o painel na porta do .env."
  echo "   • pm2 startup   (para subir sozinho após reboot do VPS)"
  exit 0
fi

# ==========================================================================
#  FASE de preparação: dependências + pastas + .env com segredos
# ==========================================================================

echo "🔎 Conferindo pré-requisitos…"
falta=0
for bin in node npm git; do
  command -v "$bin" >/dev/null 2>&1 || { echo "   ❌ falta: $bin"; falta=1; }
done
command -v pm2 >/dev/null 2>&1 || echo "   ⚠️  pm2 não instalado (instale depois: npm i -g pm2)"
command -v tsx >/dev/null 2>&1 || command -v npx >/dev/null 2>&1 || echo "   ⚠️  tsx/npx não encontrados (a SoFIA usa: npm i -g tsx)"
CHROMIUM="$(command -v chromium-browser || command -v chromium || command -v google-chrome || true)"
[ -n "$CHROMIUM" ] && echo "   ✔ Chromium: $CHROMIUM" || echo "   ⚠️  Chromium não encontrado (o WhatsApp precisa; ajuste CHROMIUM_PATH no .env)"
[ "$falta" = "0" ] || { echo "Instale os itens marcados ❌ e rode de novo."; exit 1; }

echo "📁 Criando a pasta de dados vivos (fora do repo): $SOFIA_DIR"
mkdir -p "$SOFIA_DIR"

echo "📦 Instalando dependências (Experimental)…"
( cd "$EXP_DIR" && npm install --no-audit --no-fund )
echo "📦 Instalando dependências (ChatBot)…"
( cd "$CHATBOT_DIR" && npm install --no-audit --no-fund )

# Dependências Python (agendamento no EVO / push_slots — precisa do 'requests').
# Usa um venv isolado para não esbarrar no "externally-managed-environment" das
# distros novas. O PYTHON_BIN do .env aponta para esse venv.
PY_DIR="$EXP_DIR/src/agendamento_evo"
PYBIN="python3"
if command -v python3 >/dev/null 2>&1 && [ -f "$PY_DIR/requirements.txt" ]; then
  echo "🐍 Instalando dependências Python (agendamento) num venv…"
  if python3 -m venv "$PY_DIR/.venv" 2>/dev/null && [ -x "$PY_DIR/.venv/bin/pip" ]; then
    "$PY_DIR/.venv/bin/pip" install -q --upgrade pip >/dev/null 2>&1 || true
    if "$PY_DIR/.venv/bin/pip" install -q -r "$PY_DIR/requirements.txt"; then
      PYBIN="$PY_DIR/.venv/bin/python"
    else
      echo "   ⚠️  falha ao instalar deps Python — rode à mão: $PY_DIR/.venv/bin/pip install -r $PY_DIR/requirements.txt"
    fi
  else
    echo "   ⚠️  não consegui criar o venv (instale 'python3-venv'). O agendamento (push_slots) precisa do pacote 'requests'."
  fi
else
  echo "   ⚠️  python3 não encontrado — o agendamento (push_slots) não vai rodar."
fi

# gera segredos uma vez só (reaproveitados nos dois .env quando fizer sentido)
SEG_PAINEL="$(segredo)"
TOK_FORM="$(segredo)"
TOK_SOFIA="$(segredo)"
SENHA_SUGERIDA="$(segredo | cut -c1-16)"

# ---- Experimental/.env ----------------------------------------------------
if [ -f "$EXP_DIR/.env" ]; then
  echo "⏭️  $EXP_DIR/.env já existe — mantido como está (não sobrescrevo)."
else
  echo "📝 Criando $EXP_DIR/.env"
  cat > "$EXP_DIR/.env" <<EOF
# ===== Identidade =====
STUDIO_NOME=${STUDIO_NOME:-Studio SlimFit $SLUG}

# ===== Painel (HTTP interno; o HTTPS é do Caddy) =====
PAINEL_PORT=8080
PAINEL_HOST=127.0.0.1
PAINEL_USER=admin
PAINEL_SENHA=$SENHA_SUGERIDA
PAINEL_SESSAO_SEGREDO=$SEG_PAINEL

# ===== Onde vivem os dados da SoFIA (prompt/estado/pontes) =====
SOFIA_DIR=$SOFIA_DIR

# ===== Formulário (Render) desta unidade =====
FORM_CLOUD_URL=https://SEU-FORM.onrender.com
FORM_SLOTS_TOKEN=$TOK_FORM

# ===== EVO (API W12) — [POR STUDIO] =====
EVO_BASE_URL=https://evo-integracao-api.w12app.com.br
EVO_DNS=
EVO_TOKEN=
EVO_BRANCH_ID=
EVO_ACTIVITY=
EVO_SERVICE=
# (ou por id) EVO_ACTIVITY_ID= / EVO_SERVICE_ID=

# ===== Alerta ao Studio (turma lotada) =====
ZEE_STUDIO_PHONE=

# ===== WhatsApp / navegador =====
CHROMIUM_PATH=${CHROMIUM:-/usr/bin/chromium-browser}
HEADLESS=true
WA_HEADLESS=true

# ===== Alertas (ntfy) — tópico secreto só desta unidade =====
NTFY_TOPIC=slimfit-alertas-$SLUG-$(segredo | cut -c1-6)
NTFY_URL=https://ntfy.sh

# ===== Python (venv do agendamento) =====
PYTHON_BIN=$PYBIN
EOF
fi

# ---- ChatBot/.env ---------------------------------------------------------
if [ -f "$CHATBOT_DIR/.env" ]; then
  echo "⏭️  $CHATBOT_DIR/.env já existe — mantido como está (não sobrescrevo)."
else
  echo "📝 Criando $CHATBOT_DIR/.env"
  cat > "$CHATBOT_DIR/.env" <<EOF
# ===== IA (Anthropic) — [POR STUDIO ou sua chave com controle de custo] =====
ANTHROPIC_API_KEY=

# ===== Mesma pasta de dados do painel (TEM que bater) =====
SOFIA_DIR=$SOFIA_DIR

# ===== Formulário desta unidade (a SoFIA agenda por aqui) =====
SOFIA_BOOK_URL=https://SEU-FORM.onrender.com/api/book-sofia
# Token que a SoFIA envia ao formulário (o MESMO valor no formulário):
SOFIA_TOKEN=$TOK_SOFIA

# ===== Transcrição de áudio (opcional) — chave OpenAI/Groq =====
# TRANSCRICAO_API_KEY=
EOF
fi

echo
echo "✅ Preparação concluída. AGORA edite os campos [POR STUDIO]:"
echo "   • $EXP_DIR/.env      → EVO_DNS/EVO_TOKEN, EVO_ACTIVITY/SERVICE, FORM_CLOUD_URL, ZEE_STUDIO_PHONE"
echo "   • $CHATBOT_DIR/.env  → ANTHROPIC_API_KEY, SOFIA_BOOK_URL"
echo "   • Confira que SOFIA_DIR é IGUAL nos dois arquivos."
echo "   • No formulário (Render): use o MESMO FORM_SLOTS_TOKEN e o MESMO SOFIA_TOKEN."
echo
echo "   Segredos gerados (guarde a senha do painel):"
echo "     PAINEL_SENHA (sugerida) = $SENHA_SUGERIDA"
echo
echo "   Depois, para subir tudo:"
echo "     bash setup-novo-studio.sh --slug $SLUG --start"
