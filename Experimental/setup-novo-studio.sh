#!/usr/bin/env bash
# ============================================================================
#  setup-novo-studio.sh — Provisiona UMA instância do sistema SlimFit num VPS
#  novo (modelo "um studio por VPS"). Não mexe em nada que já exista: só
#  instala dependências, cria as pastas de dados, monta os .env a partir dos
#  modelos (gerando segredos aleatórios) e — na fase --start — sobe o PM2.
#
#  USO (rode DE DENTRO da pasta Experimental/, após o git clone):
#    1) Preparação — instala tudo (sistema + deps) e monta os .env com segredos:
#         bash setup-novo-studio.sh --slug lagosul --studio "Studio SlimFit Lago Sul" --install-deps
#       (sem --install-deps, ele só instala as deps do projeto e assume que
#        Node/pm2/tsx/Chromium já existem.)
#    2) Edite os .env que ele apontar (EVO_DNS/EVO_TOKEN, ANTHROPIC_API_KEY, formulário…).
#    3) (opcional) Descubra os ids da aula no EVO — precisa do EVO já no .env:
#         bash setup-novo-studio.sh --slug lagosul --evo-ids
#    4) Subida — liga os processos e (com --domain) já configura o HTTPS via Caddy:
#         bash setup-novo-studio.sh --slug lagosul --start --domain painel-lagosul.exemplo.com
#
#  FLAGS: --slug (obrigatório) · --studio "Nome" · --install-deps · --evo-ids
#         --domain <subdominio> · --port <n> · --evo-tenant <slug> · --evo-branch <n> · --start
#
#  EVO POR UNIDADE: --evo-tenant e --evo-branch montam os caminhos que o robô usa
#  para LER o EVO (grade, faltantes, suspensões). Ache os dois na URL do EVO da
#  unidade: .../app/<tenant>/<branch>/... . Sem passar, cai no padrão da unidade
#  original (slimfit/15) — e a franquia lê os dados errados.
#
#  DUAS LOJAS NO MESMO SERVIDOR (mesmo franqueado): use DOIS clones do repo,
#  um por loja, cada um com --slug e --port diferentes. Ex.:
#     ~/slimfit-lagosul1  →  --slug lagosul1 --port 8080
#     ~/slimfit-lagosul2  →  --slug lagosul2 --port 8081
#  Assim cada loja tem seu SOFIA_DIR, seus processos PM2 (slug-prefixados),
#  seu painel (porta própria) e seus .env — 100% isolados no mesmo VPS.
#
#  Segurança: os .env NUNCA vão para o Git (estão no .gitignore). Este script
#  só ESCREVE .env se ele ainda não existir — nunca sobrescreve o seu.
# ============================================================================
set -euo pipefail

# ---- argumentos -----------------------------------------------------------
SLUG=""            # identificador curto do studio (nomes dos processos PM2)
STUDIO_NOME=""     # nome como aparece para a aluna
START=0            # --start liga os processos no PM2
INSTALL_DEPS=0     # --install-deps instala Node/pm2/tsx/chromium/python (apt)
EVO_IDS=0          # --evo-ids descobre os ids da aula no EVO (precisa do .env)
DOMAIN=""          # --domain <subdominio> gera + liga o Caddy (HTTPS) no --start
PAINEL_PORT=""     # --port <n> porta do painel (default 8080; use outra p/ 2ª loja)
EVO_TENANT=""      # --evo-tenant <slug> identificador da rede no EVO (na URL; ex.: slimfit)
EVO_BRANCH=""      # --evo-branch <n> número da unidade no EVO (aparece no caminho; ex.: 15)
while [ $# -gt 0 ]; do
  case "$1" in
    --slug)         SLUG="${2:-}"; shift 2 ;;
    --studio)       STUDIO_NOME="${2:-}"; shift 2 ;;
    --start)        START=1; shift ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    --evo-ids)      EVO_IDS=1; shift ;;
    --domain)       DOMAIN="${2:-}"; shift 2 ;;
    --port)         PAINEL_PORT="${2:-}"; shift 2 ;;
    --evo-tenant)   EVO_TENANT="${2:-}"; shift 2 ;;
    --evo-branch)   EVO_BRANCH="${2:-}"; shift 2 ;;
    -h|--help)
      grep -E '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Argumento desconhecido: $1"; exit 1 ;;
  esac
done

[ -n "$SLUG" ] || { echo "❌ Faltou --slug (ex.: --slug lagosul)"; exit 1; }
echo "$SLUG" | grep -qE '^[a-z0-9][a-z0-9-]{1,30}$' \
  || { echo "❌ --slug deve ser minúsculo, sem espaço/acento (ex.: lagosul)"; exit 1; }
[ -n "$PAINEL_PORT" ] || PAINEL_PORT=8080
echo "$PAINEL_PORT" | grep -qE '^[0-9]{2,5}$' || { echo "❌ --port deve ser um número (ex.: --port 8081)"; exit 1; }

# EVO: identificador da rede (tenant) e número da unidade (branch). O robô loga no
# EVO pelo NAVEGADOR e lê a grade/faltantes/suspensões nesses caminhos — que embutem
# o tenant e o branch. Sem passar, cai no padrão da unidade ORIGINAL (slimfit/15) e a
# franquia lê os dados errados. Avisamos alto se ficar no default.
[ -n "$EVO_TENANT" ] || EVO_TENANT="slimfit"
[ -n "$EVO_BRANCH" ] || EVO_BRANCH="15"
if [ "$EVO_TENANT" = "slimfit" ] && [ "$EVO_BRANCH" = "15" ]; then
  echo "⚠️  --evo-tenant/--evo-branch no PADRÃO (slimfit/15 = Setor Bueno)."
  echo "    Se esta NÃO é a unidade original, passe os corretos, ex.: --evo-tenant slimfitlagosul --evo-branch 22"
  echo "    (você acha os dois na URL do EVO da unidade: .../app/<tenant>/<branch>/...)"
fi

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
echo "  Painel:    porta $PAINEL_PORT"
echo "  EVO:       tenant=$EVO_TENANT · branch=$EVO_BRANCH"
echo "  Processos: $P_PAINEL · $P_EXP · $P_SOFIA"
echo "──────────────────────────────────────────────────────────"

# gera um segredo aleatório (openssl, senão node)
segredo() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"; fi
}

# roda um comando como root (sudo se não for root já)
_sudo() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

# ---- --install-deps: instala os pré-requisitos do sistema (apt/Debian/Ubuntu) --
install_system_deps() {
  echo "🧰 Instalando pré-requisitos do sistema (Node, pm2, tsx, Chromium, Python)…"
  command -v apt-get >/dev/null 2>&1 || {
    echo "   ❌ apt-get não encontrado — este instalador cobre Debian/Ubuntu."
    echo "      Instale à mão: Node 20+, git, chromium, python3-venv, e 'npm i -g pm2 tsx'."
    return 1
  }
  _sudo apt-get update -y
  # Node 20 via NodeSource se faltar node ou for < 18
  local nodemaj=0
  command -v node >/dev/null 2>&1 && nodemaj="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${nodemaj:-0}" -lt 18 ]; then
    echo "   ⬇️  instalando Node 20 (NodeSource)…"
    if [ "$(id -u)" -eq 0 ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || echo "   ⚠️  NodeSource falhou; tentando o node do apt"
    else
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || echo "   ⚠️  NodeSource falhou; tentando o node do apt"
    fi
    _sudo apt-get install -y nodejs || true
  fi
  _sudo apt-get install -y git python3 python3-venv python3-pip || true
  # Chromium: nome do pacote varia entre distros
  _sudo apt-get install -y chromium-browser 2>/dev/null || _sudo apt-get install -y chromium || \
    echo "   ⚠️  não instalei o Chromium automaticamente — ajuste CHROMIUM_PATH no .env depois."
  # ferramentas globais do Node
  command -v pm2 >/dev/null 2>&1 || _sudo npm i -g pm2 || npm i -g pm2 || true
  command -v tsx >/dev/null 2>&1 || _sudo npm i -g tsx || npm i -g tsx || true
  echo "   ✔ pré-requisitos prontos (o que faltou aparece com ⚠️ acima)."
}

# ---- --domain: gera o bloco do Caddy e (best-effort) liga o HTTPS ------------
wire_caddy() {
  local dom="$1"
  local porta; porta="$(grep -E '^PAINEL_PORT=' "$EXP_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$porta" ] || porta=8080
  local snippet="$EXP_DIR/caddy-$SLUG.caddy"
  printf '%s {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$dom" "$porta" > "$snippet"
  echo "📝 Bloco do Caddy gerado em: $snippet"
  # instala o Caddy se pedimos --install-deps e ele não existe
  if [ "$INSTALL_DEPS" = "1" ] && ! command -v caddy >/dev/null 2>&1; then
    echo "   ⬇️  instalando Caddy…"
    _sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | _sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | _sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null 2>&1 || true
    _sudo apt-get update -y || true; _sudo apt-get install -y caddy || true
  fi
  # tenta ligar automaticamente no /etc/caddy/Caddyfile (best-effort)
  if [ -f /etc/caddy/Caddyfile ]; then
    if _sudo grep -qF "$dom" /etc/caddy/Caddyfile 2>/dev/null; then
      echo "   ✔ o domínio já está no /etc/caddy/Caddyfile — nada a fazer."
    else
      { echo ""; echo "# --- $SLUG (SlimFit) ---"; cat "$snippet"; } | _sudo tee -a /etc/caddy/Caddyfile >/dev/null \
        && echo "   ✔ bloco acrescentado ao /etc/caddy/Caddyfile"
      _sudo systemctl reload caddy 2>/dev/null || _sudo systemctl restart caddy 2>/dev/null \
        || echo "   ⚠️  recarregue o Caddy à mão: sudo systemctl reload caddy"
    fi
  else
    echo "   ℹ️  Caddy não configurado ainda. Para ligar o HTTPS, coloque o bloco de"
    echo "      $snippet no seu Caddyfile e recarregue (sudo systemctl reload caddy)."
  fi
  echo "   🌐 Aponte o DNS de $dom para o IP deste VPS (o Caddy emite o certificado sozinho)."
}

# ---- --evo-ids: descobre os ids da aula experimental no EVO ------------------
run_evo_ids() {
  local pydir="$EXP_DIR/src/agendamento_evo"
  [ -f "$EXP_DIR/.env" ] || { echo "❌ $EXP_DIR/.env não existe — rode a preparação e preencha o EVO antes."; exit 1; }
  local pybin; pybin="$(grep -E '^PYTHON_BIN=' "$EXP_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$pybin" ] && [ -x "$pybin" ] || pybin="$pydir/.venv/bin/python"
  [ -x "$pybin" ] || pybin="python3"
  echo "🔎 Consultando o EVO (serviços de aula experimental)…"
  echo "   (usa EVO_DNS/EVO_TOKEN do .env — preencha antes de rodar isto)"
  echo "──────────────────────────────────────────────────────────"
  ( cd "$pydir" && "$pybin" run_agendamento.py services ) || {
    echo "──────────────────────────────────────────────────────────"
    echo "❌ Falhou. Confira EVO_DNS/EVO_TOKEN no $EXP_DIR/.env e tente de novo."
    exit 1
  }
  echo "──────────────────────────────────────────────────────────"
  echo "👉 Copie o id do serviço/atividade para EVO_SERVICE_ID / EVO_ACTIVITY_ID no .env"
  echo "   (ou use os nomes em EVO_SERVICE / EVO_ACTIVITY). Depois: --start"
}

# ---- --install-deps: instala os pré-requisitos ANTES de qualquer fase --------
if [ "$INSTALL_DEPS" = "1" ]; then install_system_deps || true; fi

# ---- --evo-ids: fase isolada de descoberta dos ids do EVO --------------------
if [ "$EVO_IDS" = "1" ]; then run_evo_ids; exit 0; fi

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

  # HTTPS automático (best-effort) quando passaram --domain
  if [ -n "$DOMAIN" ]; then wire_caddy "$DOMAIN"; fi

  echo
  echo "✅ Processos no ar. Próximos passos:"
  echo "   • Leia os QRs dos 2 WhatsApp:  pm2 logs $P_EXP   e   pm2 logs $P_SOFIA"
  [ -n "$DOMAIN" ] || echo "   • Configure o HTTPS: rode com --domain <subdominio> (gera + liga o Caddy)."
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
TOK_OUTBOX="$(segredo)"
TOK_SOFIA="$(segredo)"
SENHA_SUGERIDA="$(segredo | cut -c1-16)"
# Tópico ntfy ÚNICO desta unidade — o MESMO no robô e na SoFIA (senão a SoFIA não
# alerta quando a sessão dela cai/trava). Gerado uma vez e usado nos dois .env.
NTFY_TOPIC_VAL="slimfit-alertas-$SLUG-$(segredo | cut -c1-6)"

# ---- Experimental/.env ----------------------------------------------------
if [ -f "$EXP_DIR/.env" ]; then
  echo "⏭️  $EXP_DIR/.env já existe — mantido como está (não sobrescrevo)."
else
  echo "📝 Criando $EXP_DIR/.env"
  cat > "$EXP_DIR/.env" <<EOF
# ===== Identidade =====
STUDIO_NOME=${STUDIO_NOME:-Studio SlimFit $SLUG}

# ===== Painel (HTTP interno; o HTTPS é do Caddy) =====
PAINEL_PORT=$PAINEL_PORT
PAINEL_HOST=127.0.0.1
PAINEL_USER=admin
PAINEL_SENHA=$SENHA_SUGERIDA
PAINEL_SESSAO_SEGREDO=$SEG_PAINEL
# Duração da sessão de login, em dias (padrão 30):
# PAINEL_SESSAO_DIAS=30

# ===== Login com Google (opcional) — só ativa se preencher os DOIS =====
# Crie no Google Cloud (OAuth) e libere o domínio do painel. Só entram os
# e-mails já cadastrados em Perfis (o admin usa PAINEL_ADMIN_EMAIL abaixo).
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# E-mail Google do admin do sistema (entra pelo Google como admin):
# PAINEL_ADMIN_EMAIL=

# ===== Onde vivem os dados da SoFIA (prompt/estado/pontes) =====
SOFIA_DIR=$SOFIA_DIR

# ===== Formulário (Render) desta unidade =====
FORM_CLOUD_URL=https://SEU-FORM.onrender.com
# Token que o robô ENVIA a grade ao formulário (mesmo valor no form: FORM_SLOTS_TOKEN):
FORM_SLOTS_TOKEN=$TOK_FORM
# Token que o robô PUXA agendamentos/confirmações/indicadores do formulário
# (mesmo valor no form: FORM_OUTBOX_TOKEN) — SEM ele o form recusa (403) e nada volta:
FORM_OUTBOX_TOKEN=$TOK_OUTBOX

# ===== EVO (API W12 — usado pela SoFIA/formulário p/ AGENDAR) — [POR STUDIO] =====
EVO_BASE_URL=https://evo-integracao-api.w12app.com.br
EVO_DNS=
EVO_TOKEN=
EVO_BRANCH_ID=$EVO_BRANCH
EVO_ACTIVITY=
EVO_SERVICE=
# (ou por id) EVO_ACTIVITY_ID= / EVO_SERVICE_ID=

# ===== EVO (robô — login pelo NAVEGADOR p/ LER grade/faltantes/etc.) — [POR STUDIO] =====
# Sem EVO_EMAIL/EVO_PASSWORD o robô NÃO loga no EVO e os jobs diários (ausentes,
# renovação, presença, resumos) falham. Os caminhos abaixo já vêm montados com o
# tenant "$EVO_TENANT" e a unidade "$EVO_BRANCH" (das flags --evo-tenant/--evo-branch).
EVO_URL=https://$EVO_TENANT.w12app.com.br
EVO_EMAIL=
EVO_PASSWORD=
EVO_LOGIN_PATH="#/acesso/$EVO_TENANT/autenticacao"
EVO_EXPERIMENTAL_PATH="#/app/$EVO_TENANT/$EVO_BRANCH/gerencial/aula-experimental"
EVO_SUSPENSOES_HASH="#/app/$EVO_TENANT/$EVO_BRANCH/gerencial/suspensoes"
EVO_FALTANTES_HASH="#/app/$EVO_TENANT/$EVO_BRANCH/evo3/-CRM-Faltantes-Faltantes"

# ===== Alerta ao Studio (turma lotada) =====
ZEE_STUDIO_PHONE=

# ===== Vigia externo (watchdog) — processos DESTA unidade (nomes já corretos) =====
WATCHDOG_PROCS=$P_EXP,$P_PAINEL,$P_SOFIA

# ===== Planilha de aniversários (opcional) — [POR STUDIO se for usar] =====
# GOOGLE_SA_KEY=$EXP_DIR/service-account.json
# SHEETS_ID=
# SHEETS_ABA=Aniversarios

# ===== WhatsApp / navegador =====
CHROMIUM_PATH=${CHROMIUM:-/usr/bin/chromium-browser}
HEADLESS=true
WA_HEADLESS=true

# ===== Alertas (ntfy) — tópico secreto só desta unidade =====
NTFY_TOPIC=$NTFY_TOPIC_VAL
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

# ===== Alertas (ntfy) — MESMO tópico do robô, p/ a SoFIA avisar QR/queda/travamento =====
NTFY_TOPIC=$NTFY_TOPIC_VAL
NTFY_URL=https://ntfy.sh

# ===== Transcrição de áudio (opcional) — chave OpenAI/Groq =====
# TRANSCRICAO_API_KEY=
EOF
fi

echo
echo "✅ Preparação concluída. AGORA edite os campos [POR STUDIO]:"
echo "   • $EXP_DIR/.env      → EVO_EMAIL + EVO_PASSWORD (login do robô no EVO — SEM eles os jobs diários falham),"
echo "                          EVO_DNS/EVO_TOKEN, EVO_ACTIVITY/SERVICE, FORM_CLOUD_URL, ZEE_STUDIO_PHONE"
echo "                          (confira EVO_URL e os *_PATH/*_HASH: tenant=$EVO_TENANT branch=$EVO_BRANCH)"
echo "   • $CHATBOT_DIR/.env  → ANTHROPIC_API_KEY, SOFIA_BOOK_URL"
echo "   • Confira que SOFIA_DIR é IGUAL nos dois arquivos."
echo "   • No formulário (Render): use os MESMOS TRÊS tokens — FORM_SLOTS_TOKEN,"
echo "     FORM_OUTBOX_TOKEN e SOFIA_TOKEN (os valores gerados estão nos .env acima)."
echo
echo "   Segredos gerados (guarde a senha do painel):"
echo "     PAINEL_SENHA (sugerida) = $SENHA_SUGERIDA"
echo
echo "   Depois de preencher o EVO no .env, descubra os ids da aula (opcional):"
echo "     bash setup-novo-studio.sh --slug $SLUG --evo-ids"
echo
echo "   E para subir tudo (com HTTPS automático):"
echo "     bash setup-novo-studio.sh --slug $SLUG --start --domain painel-$SLUG.SEU-DOMINIO"
