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
    ap.add_argument("--sem-financeiro", dest="sem_financeiro", action="store_true",
                    help="NÃO calcula o TKM/faturamento (mais rápido, menos chamadas ao EVO)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING, stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")

    data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
    fin_cache_path = os.path.join(data_dir, "grade-financeiro.json")
    enroll_cache_path = os.path.join(data_dir, "grade-enroll.json")
    full = not args.sem_financeiro

    # "Atualizar grade" (leve): não recalcula o financeiro nem relê as matrículas —
    # reaproveita os caches da última geração completa (05:40 ou "Atualizar tudo"),
    # consultando o EVO só para a presença das turmas e alunas novas.
    # O financeiro em cache é reaproveitado no modo leve E serve de FALLBACK na
    # geração completa (se a leitura ao vivo falhar por 429, o TKM não some).
    fin_cache, enroll_cache = None, None
    try:
        with open(fin_cache_path, encoding="utf-8") as f:
            fin_cache = json.load(f)
    except Exception:
        fin_cache = None            # sem cache ainda → grade vai sem financeiro
    if not full:
        try:
            with open(enroll_cache_path, encoding="utf-8") as f:
                enroll_cache = (json.load(f) or {}).get("fix")
        except Exception:
            enroll_cache = None

    from evo_agendamento.grade_fixas import montar_grade
    res = montar_grade(semana_offset=args.semana, financeiro=full, fin_cache=fin_cache,
                       enroll_cache=enroll_cache, refresh_enroll=full)

    # separa os blocos internos de cache (não vão pro snapshot do painel)
    fin_block = res.pop("_fin_cache", None)
    enroll_out = res.pop("_enroll", None)

    # snapshot servido pela página /grade. Semana atual = grade-fixas.json; outras
    # semanas = grade-fixas.s<off>.json (para a navegação de semanas).
    base = "grade-fixas.json" if args.semana == 0 else f"grade-fixas.s{args.semana}.json"
    out = os.path.join(data_dir, base)
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
    except Exception as e:
        print(f"ERRO ao gravar {out}: {e}", file=sys.stderr)

    # grava o cache financeiro só quando foi calculado ao vivo (geração completa)
    if full and fin_block:
        try:
            with open(fin_cache_path, "w", encoding="utf-8") as f:
                json.dump(fin_block, f, ensure_ascii=False)
        except Exception as e:
            print(f"ERRO ao gravar {fin_cache_path}: {e}", file=sys.stderr)

    # grava o cache de matrículas (completa reseta; leve mescla) — só p/ a semana atual
    if enroll_out is not None and args.semana == 0:
        try:
            with open(enroll_cache_path, "w", encoding="utf-8") as f:
                json.dump({"gerado_em": res.get("gerado_em"), "fix": enroll_out}, f, ensure_ascii=False)
        except Exception as e:
            print(f"ERRO ao gravar {enroll_cache_path}: {e}", file=sys.stderr)

    if args.imprimir:
        r = res["resumo"]
        print(f"📋 Grade {res['inicio']}..{res['fim']} (semana {args.semana}) — "
              f"{r['turmas']} turmas, {r['fixas']} matrículas fixas "
              f"({r.get('alunas_fixas', '?')} alunas fixas)")
        oc = r.get('ocupacao_pct')
        print(f"   ocupação por fixas (sem sábado): {oc if oc is not None else '?'}% "
              f"({r.get('ocupacao_fixas', '?')}/{r.get('ocupacao_vagas', '?')} vagas)")
        pr = r.get('presenca_pct')
        if pr is not None:
            print(f"   presença na turma (aulas realizadas): {pr}% "
                  f"({r.get('presenca_real', '?')}/{r.get('presenca_vagas', '?')} vagas)")
        if r.get('ativas') is not None:
            tr = r.get('trancadas') or 0
            vp = r.get('vips') or 0
            print(f"   alunas ativas (Active + trancadas, sem VIP): {r['ativas']}"
                  + (f" ({tr} trancadas)" if tr else "")
                  + (f" · {vp} VIP excluídas" if vp else ""))
        if r.get('tkm_medio') is not None:
            print(f"   TKM médio (contrato mensalizado): R$ {r['tkm_medio']:.2f} "
                  f"(de {r.get('tkm_alunas', '?')} alunas com contrato)")
        if r.get('fatura_mes') is not None:
            print(f"   faturamento do mês (a vencer): R$ {r['fatura_mes']:.2f} "
                  f"({r.get('fatura_n', '?')} lançamentos)")
        if r.get('tkm_medio') is not None:
            print("   financeiro: " + ("calculado agora (leu o EVO)" if full
                  else f"reaproveitado de {res.get('financeiro_em', '?')} (sem tocar no EVO)"))
        elif not full:
            print("   financeiro: sem cache ainda — rode uma geração completa (sem --sem-financeiro)")
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
