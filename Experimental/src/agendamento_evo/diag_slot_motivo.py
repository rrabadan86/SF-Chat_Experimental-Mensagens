#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAG (só LEITURA) — por que um horário APARECE ou SOME no formulário/Express.

Replica a MESMA decisão de available_slots() para UMA data e imprime, horário a
horário, o motivo de entrar ou ficar de fora (antecedência, capacidade, turma
fechada/cadeado, limite de experimentais…).

USO (na pasta agendamento_evo, com o .env da unidade):
    python diag_slot_motivo.py --data 2026-10-15
    python diag_slot_motivo.py --data 2026-10-15 --hora 08:20
"""
import argparse
from datetime import datetime

from evo_agendamento import EvoClient
from evo_agendamento import config
from evo_agendamento.util import session_start_datetime, agora_brasilia
from evo_agendamento.orchestrator import (
    _match_activity, turma_fechada, _antecedencia_ok, count_experimentais,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="Data yyyy-MM-dd")
    ap.add_argument("--hora", default=None, help="Foca um horário HH:MM (opcional)")
    args = ap.parse_args()

    evo = EvoClient()
    now = agora_brasilia()
    alvo = datetime.strptime(args.data, "%Y-%m-%d")

    activity = config.EVO_ACTIVITY or None
    id_activity = config.EVO_ACTIVITY_ID or None
    lim_exp = config.max_experimentais()
    antec = config.antecedencia_horas()

    print(f"🔎 Motivo dos horários — {alvo:%d/%m/%Y}   (agora={now:%d/%m %H:%M})")
    print(f"   atividade filtro: {activity or '(qualquer)'}  | "
          f"limite experimentais/turma: {lim_exp or 'SEM LIMITE'}  | "
          f"antecedência mínima: {antec}h\n")

    try:
        sched = evo.list_schedule(alvo, show_full_week=True) or []
    except Exception as e:
        print(f"ERRO list_schedule: {e}")
        return

    # só as sessões do dia pedido
    dia = []
    for s in sched:
        dt = session_start_datetime(s)
        if dt is not None and dt.date() == alvo.date():
            dia.append((dt, s))
    dia.sort(key=lambda x: x[0])

    if not dia:
        print("   (nenhuma turma nesse dia)")
        return

    print(f"{'HORA':<6} {'ATIVIDADE':<22} {'OCUP':>7} {'EXP':>4}  RESULTADO / MOTIVO")
    print("-" * 92)
    for dt, s in dia:
        hora = dt.strftime("%H:%M")
        if args.hora and hora != args.hora:
            continue
        nome = (s.get("name") or "")[:21]
        cap = s.get("capacity")
        ocup = s.get("ocupation") or 0
        ocup_txt = f"{ocup}/{cap}" if cap is not None else str(ocup)

        motivos = []
        ok = True
        if not _match_activity(s, activity, id_activity):
            ok = False
            motivos.append(f"atividade não casa com '{activity}'")
        if dt < now:
            ok = False
            motivos.append("já passou")
        if not _antecedencia_ok(dt, now):
            ok = False
            motivos.append(f"antecedência < {antec}h (ou fim de semana)")
        if cap is not None and ocup >= cap:
            ok = False
            motivos.append(f"turma cheia ({ocup}/{cap})")
        if turma_fechada(s):
            ok = False
            motivos.append("turma FECHADA (cadeado)")

        # experimentais só importam se, até aqui, estaria disponível
        n_exp = ""
        if ok and lim_exp:
            try:
                ne = count_experimentais(evo, s.get("idConfiguration"), dt)
            except Exception as e:
                ne = None
                motivos.append(f"erro ao contar experimentais: {e}")
            n_exp = "" if ne is None else str(ne)
            if ne is not None and ne >= lim_exp:
                ok = False
                motivos.append(f"limite de experimentais atingido ({ne}/{lim_exp})")

        res = "✅ APARECE" if ok else "❌ SOME — " + "; ".join(motivos)
        print(f"{hora:<6} {nome:<22} {ocup_txt:>7} {str(n_exp):>4}  {res}")

    print()


if __name__ == "__main__":
    main()
