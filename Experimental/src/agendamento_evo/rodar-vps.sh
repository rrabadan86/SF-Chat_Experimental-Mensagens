#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Equivalente Linux/VPS do rodar.bat (Windows).
# Roda o cadastro automático ZEE -> EVO usando o venv local.
# Chamado pelo cron a cada 5 min. O .env deve estar nesta pasta.
# ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1
exec .venv/bin/python run_agendamento.py run --hours-back 24 >> agendamento.log 2>&1
