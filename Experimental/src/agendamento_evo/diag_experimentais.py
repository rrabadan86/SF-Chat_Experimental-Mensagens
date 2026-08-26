#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO: o que a API do EVO devolve sobre AULAS EXPERIMENTAIS por horário?

Objetivo: descobrir se a agenda do EVO informa, por turma/horário, QUANTAS aulas
experimentais já estão marcadas (ou quantas vagas de experimental restam). Isso é
o que precisamos para bloquear "já tem 2 experimentais no horário".

COMO USAR (dentro da pasta agendamento_evo, onde está o .env):
    python diag_experimentais.py
    python diag_experimentais.py --data 2026-07-23      (uma data específica)
    python diag_experimentais.py --hora 19:30           (foca num horário)

Ele imprime, para cada turma do dia, TODOS os campos que a API devolve — em
especial qualquer coisa ligada a experimental (experimentalClassSlots, ocupation,
capacity, etc.). Me manda a saída (principalmente a do horário das 19:30) que eu
identifico o campo certo e implemento o limite.
"""
import argparse
import json
from datetime import datetime

from evo_agendamento import EvoClient
from evo_agendamento.util import session_start_datetime


def dump_sessions(titulo, sessions, hora_foco):
    print(f"\n================= {titulo} =================")
    if not sessions:
        print("  (vazio / nenhum retorno)")
        return
    for s in sessions:
        dt = session_start_datetime(s)
        hhmm = dt.strftime("%H:%M") if dt else "??:??"
        nome = s.get("name") or s.get("activity") or ""
        marca = "   <<<<<< HORÁRIO EM FOCO" if (hora_foco and hhmm == hora_foco) else ""
        print(f"\n--- {hhmm}  {nome}  (idConfiguration={s.get('idConfiguration')}){marca}")
        # JSON COMPLETO de TODAS as turmas — é onde o campo de "turma fechada"
        # (cadeado) deve aparecer. Comparando a turma fechada com as abertas,
        # achamos qual campo muda.
        print(json.dumps(s, ensure_ascii=False, indent=2, default=str))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", help="Data yyyy-MM-dd (padrão: hoje)")
    ap.add_argument("--hora", default="16:15", help="Horário a focar (padrão 16:15)")
    args = ap.parse_args()

    data = datetime.strptime(args.data, "%Y-%m-%d") if args.data else datetime.now()
    print(f"Consultando a agenda do EVO para {data.strftime('%d/%m/%Y')} (foco {args.hora})...")

    evo = EvoClient()

    # 1) agenda GERAL (a que o bot usa hoje)
    try:
        geral = evo.list_schedule(data, show_full_week=True) or []
        geral = [s for s in geral if _mesmo_dia(session_start_datetime(s), data)]
        dump_sessions("AGENDA GERAL (list_schedule)", geral, args.hora)
    except Exception as e:
        print(f"  ERRO list_schedule: {e}")

    # 2) agenda de EXPERIMENTAIS (endpoint com experimentalClass=True)
    try:
        exp = evo.list_experimental_schedule(data, show_full_week=True) or []
        exp = [s for s in exp if _mesmo_dia(session_start_datetime(s), data)]
        dump_sessions("AGENDA EXPERIMENTAL (list_experimental_schedule)", exp, args.hora)
    except Exception as e:
        print(f"  ERRO list_experimental_schedule: {e}")

    print("\n----------------------------------------------------------------")
    print("Rode com a data da SEXTA e o horário FECHADO, ex.:")
    print("   python3 diag_experimentais.py --data 2026-08-28 --hora 16:15")
    print("Me manda TODA a saída. Vou comparar o JSON da turma FECHADA (16:15)")
    print("com o das abertas para achar o campo que marca o 'cadeado'.")


def _mesmo_dia(dt, ref):
    return dt is not None and dt.date() == ref.date()


if __name__ == "__main__":
    main()
