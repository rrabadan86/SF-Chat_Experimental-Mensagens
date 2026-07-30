#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Inicia o agendador do SlimFit (Experimental) no VPS Linux,
# dentro de uma tela virtual (Xvfb), já que rodamos com HEADLESS=false.
# Usado pelo PM2:  pm2 start ./scheduler-vps.sh --name slimfit-exp
# ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1

# -a          → escolhe um número de display livre (evita conflito ao reiniciar)
# --server-args → resolução/profundidade da tela virtual
exec xvfb-run -a --server-args="-screen 0 1366x900x24" node src/scheduler.js
