#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Monta a grade de MATRÍCULAS FIXAS e grava o snapshot em data/grade-fixas.json.

Uso (na pasta agendamento_evo, com o .env da unidade):
    .venv/bin/python run_grade_fixas.py --print           # imprime e grava
    .venv/bin/python run_grade_fixas.py --dias 7          # próximos 7 dias
    .venv/bin/python run_grade_fixas.py --print | grep -i "rachel"   # conferir uma aluna

A 1ª rodada é lenta (lê o plano de cada aluna no EVO p/ separar FREE; fica em cache
por 7 dias — as próximas são rápidas).
"""
import argparse
import json
import logging
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=7, help="quantos dias à frente (padrão 7)")
    ap.add_argument("--print", dest="imprimir", action="store_true",
                    help="imprime um resumo legível (além de gravar o JSON)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING, stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")

    from evo_agendamento.grade_fixas import montar_grade
    res = montar_grade(dias=args.dias)

    # grava o snapshot que a página /grade vai servir (Experimental/data/)
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
                                       "data", "grade-fixas.json"))
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
    except Exception as e:
        print(f"ERRO ao gravar {out}: {e}", file=sys.stderr)

    if args.imprimir:
        r = res["resumo"]
        print(f"📋 Grade de fixas {res['inicio']}..{res['fim']} — {r['turmas']} turmas, "
              f"{r['fixas']} matrículas fixas")
        print(f"   fora: {r['excluidas_free']} FREE · {r['excluidas_reposicao']} reposição · "
              f"{r['excluidas_experimental']} experimental · {r['excluidas_removidas']} removida(s)")
        print(f"   arquivo: {out}\n")
        _WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
        for t in res["turmas"]:
            prof = f" · {t['professora']}" if t["professora"] else ""
            vagas = t["vagas"] if t["vagas"] is not None else "?"
            print(f"  {t['data']} ({_WD[t['weekday']]}) {t['hora']} {t['activity']}{prof} "
                  f"— {t['nFixas']}/{t['capacity']} fixas · {vagas} vaga(s)")
            if t["fixas"]:
                print("        " + " | ".join(t["fixas"]))
    else:
        print(json.dumps({"ok": True, "arquivo": out, **res["resumo"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
