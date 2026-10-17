#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Monta a grade da SEMANA (vaga de matrícula + ocupação real + presença das fixas) e
grava o snapshot em data/grade-fixas.json (semana atual) ou data/grade-fixas.sN.json.

Uso (na pasta agendamento_evo, com o .env da unidade):
    .venv/bin/python run_grade_fixas.py --print          # semana atual, imprime e grava
    .venv/bin/python run_grade_fixas.py --semana -1      # semana anterior
    .venv/bin/python run_grade_fixas.py --semana 1       # próxima semana

FIXA = quem tem aquele idConfiguration na própria matrícula (member-enrollment).
Reposição = fixa em OUTRA turma; FREE = sem turma fixa. Presença só nas aulas que já
aconteceram. Lê 1 member-enrollment por aluna (em cache) — dezenas de chamadas ao EVO.
"""
import argparse
import json
import logging
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--semana", type=int, default=0,
                    help="offset de semana (0 = atual, -1 = anterior, 1 = próxima)")
    ap.add_argument("--print", dest="imprimir", action="store_true",
                    help="imprime um resumo legível (além de gravar o JSON)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING, stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")

    from evo_agendamento.grade_fixas import montar_grade
    res = montar_grade(semana_offset=args.semana)

    # snapshot servido pela página /grade. Semana atual = grade-fixas.json; outras
    # semanas = grade-fixas.s<off>.json (para a navegação de semanas).
    base = "grade-fixas.json" if args.semana == 0 else f"grade-fixas.s{args.semana}.json"
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", base))
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
    except Exception as e:
        print(f"ERRO ao gravar {out}: {e}", file=sys.stderr)

    if args.imprimir:
        r = res["resumo"]
        print(f"📋 Grade {res['inicio']}..{res['fim']} (semana {args.semana}) — "
              f"{r['turmas']} turmas, {r['fixas']} matrículas fixas "
              f"({r.get('alunas_fixas', '?')} alunas fixas)")
        oc = r.get('ocupacao_pct')
        print(f"   ocupação por fixas (sem sábado): {oc if oc is not None else '?'}% "
              f"({r.get('ocupacao_fixas', '?')}/{r.get('ocupacao_vagas', '?')} vagas)")
        print(f"   arquivo: {out}\n")
        _WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
        _IC = {"foi": "✓", "faltou": "✗", "justif": "⚠"}
        for t in res["turmas"]:
            prof = f" · {t['professora']}" if t["professora"] else ""
            vagas = t["vagas"] if t["vagas"] is not None else "?"
            extra = f" · {t['nReal']}/{t['capacity']} na turma" if t.get("nReal") else ""
            pres = ""
            if t.get("aconteceu") and t.get("presentes") is not None:
                pres = f" · {t['presentes']} foram / {t['faltas']} faltaram"
            print(f"  {t['data']} ({_WD[t['weekday']]}) {t['hora']} {t['activity']}{prof} "
                  f"— {t['nFixas']}/{t['capacity']} fixas · {vagas} vaga(s){extra}{pres}")
            if t["fixas"]:
                nomes = [f"{_IC.get(x['pres'], '•')} {x['nome']}" for x in t["fixas"]]
                print("        fixas: " + " | ".join(nomes))
            if t.get("reposicao"):
                print("        repô:  " + " | ".join(t["reposicao"]))
            if t.get("free"):
                print("        FREE:  " + " | ".join(t["free"]))
    else:
        print(json.dumps({"ok": True, "arquivo": out, **res["resumo"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
