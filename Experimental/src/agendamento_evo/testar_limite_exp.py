#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste NÃO-DESTRUTIVO do limite de experimentais (só leitura, não agenda nada).

1) Conta as experimentais ATIVAS na turma das 19:30 (deve dar 2).
2) Mostra como o FORMULÁRIO enxerga esse horário (disponivel deve ser False).

Rode na pasta agendamento_evo (com o .env):
    python testar_limite_exp.py
    python testar_limite_exp.py --idconfig 1201 --data 2026-07-23 --hora 19:30
"""
import argparse

from evo_agendamento import EvoClient, config
from evo_agendamento.orchestrator import count_experimentais, available_slots


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idconfig", default="1201")
    ap.add_argument("--data", default="2026-07-23")
    ap.add_argument("--hora", default="19:30")
    args = ap.parse_args()

    evo = EvoClient()
    print(f"Limite configurado: EVO_MAX_EXPERIMENTAIS = {config.EVO_MAX_EXPERIMENTAIS}\n")

    # 1) contagem direta na turma
    n = count_experimentais(evo, args.idconfig, args.data)
    print(f"1) Experimentais ATIVAS na turma {args.idconfig} em {args.data}: {n}")
    print(f"   (no horário {args.hora} o esperado é 2 -> Rosalina e Ana Beatriz)\n")

    # 2) como o formulário vê os próximos dias — foca no horário/data pedidos
    print("2) Visão do FORMULÁRIO (available_slots) — pode demorar alguns segundos...")
    slots = available_slots(evo=evo, days=10, max_ocupacao=config.__dict__.get("FORM_MAX", 7))
    achou = False
    for s in slots:
        if s["date"] == args.data and s["time"] == args.hora:
            achou = True
            print(f"   {s['date']} {s['time']} {s['activity']} | "
                  f"ocupacao={s['ocupation']}/{s['capacity']} | "
                  f"experimentais={s.get('experimentais')} | "
                  f"DISPONÍVEL={s['disponivel']}")
            print("   -> Esperado: DISPONÍVEL=False (já tem 2 experimentais).")
    if not achou:
        print(f"   (o horário {args.hora} de {args.data} não está na grade dos próximos 10 dias — "
              f"talvez já tenha passado; rode com --data de um dia futuro que tenha esse horário)")

    print("\n✅ Se a contagem deu 2 e DISPONÍVEL=False, o limite está funcionando.")


if __name__ == "__main__":
    main()
