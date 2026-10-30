#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FOTO DIÁRIA das alunas ativas (Indicadores → Alunas ativas).

Uma vez por dia (o robô chama de madrugada) lê no EVO a lista de clientes e grava
em data/alunas-ativas-historico.json, para o dia de hoje:
  ativas    = contrato vigente (active) + TRANCADAS (suspended) — trancada é ativa
  trancadas = quantas das ativas estão trancadas
  entraram  = ativas hoje que não estavam na foto anterior
  sairam    = estavam na foto anterior e hoje não estão mais
Rodar de novo no mesmo dia só atualiza o dia (não duplica). Só LÊ o EVO
(/api/v1/members, paginado — poucas chamadas).

Uso (na pasta agendamento_evo, com o .env da unidade):
    .venv/bin/python run_ativas_foto.py
"""
import json
import os
import sys
from datetime import datetime, timezone, timedelta

try:
    from evo_agendamento import EvoClient
except Exception as e:  # pragma: no cover
    print(f"[ERRO] não consegui importar o pacote evo_agendamento: {e}")
    sys.exit(1)

ATIVOS = ("active", "suspended")  # trancada = ativa
ARQ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "alunas-ativas-historico.json"))


def hoje_sp():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date().isoformat()


def main():
    evo = EvoClient()
    ativas, trancadas, take, skip = set(), set(), 100, 0
    for _ in range(200):
        rows = evo._request("GET", "/api/v1/members", params={"take": take, "skip": skip}) or []
        if not isinstance(rows, list) or not rows:
            break
        for m in rows:
            st = str(m.get("membershipStatus") or "").strip().lower()
            idm = m.get("idMember")
            if idm is not None and st in ATIVOS:
                ativas.add(str(idm))
                if st == "suspended":
                    trancadas.add(str(idm))
        if len(rows) < take:
            break
        skip += take
    if not ativas:
        print("[ERRO] o EVO não devolveu nenhuma aluna ativa — foto NÃO gravada (evita um zero falso).")
        sys.exit(1)

    try:
        with open(ARQ, encoding="utf-8") as f:
            h = json.load(f)
    except Exception:
        h = {}
    dias = h.get("dias") or {}
    dia = hoje_sp()
    ant = h.get("ultimo") or {}
    # compara com a última foto de OUTRO dia (rodar 2x no mesmo dia não zera o saldo)
    base = set(ant.get("ids") or []) if ant.get("dia") != dia else set(h.get("anterior", {}).get("ids") or [])
    if ant.get("dia") and ant.get("dia") != dia:
        h["anterior"] = ant
    entraram = len(ativas - base) if base else None
    sairam = len(base - ativas) if base else None
    dias[dia] = {"ativas": len(ativas), "trancadas": len(trancadas), "entraram": entraram, "sairam": sairam}
    h["dias"] = dict(sorted(dias.items()))
    h["ultimo"] = {"dia": dia, "ids": sorted(ativas)}
    os.makedirs(os.path.dirname(ARQ), exist_ok=True)
    tmp = ARQ + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(h, f, ensure_ascii=False)
    os.replace(tmp, ARQ)
    extra = f" · entraram {entraram} · saíram {sairam}" if base else " · primeira foto (entradas/saídas a partir de amanhã)"
    print(f"foto de alunas ativas {dia}: {len(ativas)} ativas ({len(trancadas)} trancadas){extra}")


if __name__ == "__main__":
    main()
