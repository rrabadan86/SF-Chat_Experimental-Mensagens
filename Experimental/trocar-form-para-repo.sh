#!/usr/bin/env bash
# Faz o FORMULÁRIO de uma unidade (processo pm2 "<unidade>-form") rodar do
# REPOSITÓRIO PRINCIPAL (Experimental/src/agendamento_evo), como no Lago Sul —
# em vez de um clone separado do sf-formularioexperimental (Bueno: /root/sf-form-real;
# Park Sul: /root/sf-form-parksul), que ficou para trás (ex.: sem o Circuito Slim).
#
# Mantém tudo o que a instalação antiga usava:
#   • o .env do formulário antigo (via FORM_ENV_FILE — vale sobre o .env daqui);
#   • a MESMA porta (lida do processo atual no pm2);
#   • os arquivos de dados do formulário antigo (fila de confirmações, agendamentos,
#     indicadores, grade enviada) — nada fica pendente para trás.
#
# Uso (no servidor da unidade, depois do slimfit-atualizar):
#   bash Experimental/trocar-form-para-repo.sh slimfit-form /root/sf-form-real
#   bash Experimental/trocar-form-para-repo.sh slimfit-form /root/sf-form-real --voltar   # desfaz
set -euo pipefail
NOME="${1:?informe o nome do processo do formulário no pm2 (ex.: slimfit-form)}"
ANT="${2:?informe a pasta do formulário antigo (ex.: /root/sf-form-real)}"
MODO="${3:-}"
ANT="$(cd "$ANT" && pwd)"
REPO_FORM="$(cd "$(dirname "$0")/src/agendamento_evo" && pwd)"
SALVO="$ANT/.porta-form"

porta_atual() {
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      let l = []; try { l = JSON.parse(s); } catch (_) {}
      const p = l.find(x => x.name === process.argv[1]); if (!p) return;
      const a = [].concat((p.pm2_env && p.pm2_env.args) || []).join(" ");
      const m = a.match(/--bind[ =]\S*:(\d+)/); if (m) console.log(m[1]);
    });' "$NOME"
}
testar() {
  local porta="$1" ok=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 2
    for pref in "" "/agendamentoexperimental"; do
      if curl -fsS "http://127.0.0.1:$porta$pref/health" >/dev/null 2>&1; then ok=1; break 2; fi
    done
  done
  [ -n "$ok" ]
}

if [ "$MODO" = "--voltar" ]; then
  PORTA="$(cat "$SALVO" 2>/dev/null || true)"; [ -n "$PORTA" ] || PORTA="$(porta_atual)"
  [ -n "$PORTA" ] || { echo "❌ Não sei a porta do formulário (sem $SALVO e sem processo no pm2)."; exit 1; }
  echo "↩️  Voltando o $NOME para $ANT (porta $PORTA)…"
  pm2 delete "$NOME" >/dev/null 2>&1 || true
  ( cd "$ANT" && pm2 start "$ANT/.venv/bin/gunicorn" --name "$NOME" --interpreter "$ANT/.venv/bin/python" --time -- \
      formulario_web.app:app --workers 1 --threads 8 --timeout 120 --bind "127.0.0.1:$PORTA" >/dev/null )
  if testar "$PORTA"; then pm2 save >/dev/null; echo "✅ $NOME de volta na pasta antiga e respondendo."; else echo "⚠️  Subiu, mas não respondeu ao /health — veja: pm2 logs $NOME --lines 50"; fi
  exit 0
fi

[ -f "$ANT/.env" ] || { echo "❌ Não achei $ANT/.env (o .env do formulário antigo)."; exit 1; }
PORTA="$(porta_atual)"
[ -n "$PORTA" ] || { echo "❌ Não achei o processo \"$NOME\" no pm2 (ou a porta dele). Confira com: pm2 ls"; exit 1; }
echo "$PORTA" > "$SALVO"
echo "📋 $NOME: porta $PORTA · .env e dados de $ANT · código de $REPO_FORM"

if [ ! -x "$REPO_FORM/.venv/bin/gunicorn" ]; then
  echo "🐍 Criando o ambiente Python do formulário no repositório principal…"
  ( cd "$REPO_FORM" && { [ -x .venv/bin/python ] || python3 -m venv .venv; } && .venv/bin/pip install -q -r requirements.txt )
fi

echo "🔁 Trocando o processo (o formulário fica fora do ar por alguns segundos)…"
pm2 delete "$NOME" >/dev/null 2>&1 || true
( cd "$REPO_FORM" && \
  FORM_ENV_FILE="$ANT/.env" \
  FORM_OUTBOX_FILE="$ANT/web_outbox.jsonl" \
  FORM_IND_FILE="$ANT/web_indicadores.jsonl" \
  FORM_BOOKINGS_FILE="$ANT/web_bookings.jsonl" \
  FORM_PUSH_FILE="$ANT/slots_pushed.json" \
  STUDIO_OUTBOX_FILE="$ANT/confirmacoes_outbox.jsonl" \
  pm2 start "$REPO_FORM/.venv/bin/gunicorn" --name "$NOME" --interpreter "$REPO_FORM/.venv/bin/python" --time -- \
    formulario_web.app:app --workers 1 --threads 8 --timeout 120 --bind "127.0.0.1:$PORTA" >/dev/null )

if testar "$PORTA"; then
  pm2 save >/dev/null
  echo "✅ Pronto: o $NOME agora roda do repositório principal (porta $PORTA)."
  echo "   Para desfazer: bash $(cd "$(dirname "$0")" && pwd)/trocar-form-para-repo.sh $NOME $ANT --voltar"
else
  echo "⚠️  O formulário não respondeu. Voltando para a pasta antiga…"
  bash "$0" "$NOME" "$ANT" --voltar
  echo "   Mande o resultado de: pm2 logs $NOME --lines 50 --nostream"
  exit 1
fi
