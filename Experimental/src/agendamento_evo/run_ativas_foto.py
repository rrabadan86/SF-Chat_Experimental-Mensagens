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

Também RECONSTRÓI o histórico dia a dia pelos contratos de todas as clientes
(início, fim e cancelamento — a lista do EVO traz os contratos antigos das
ex-alunas). Validado no Bueno: as ativas de hoje reconstruídas batem com as
reais. Renovação com até 7 dias de atraso não conta como saída/retorno.
Vai em "reconstruido": { inicio, ativas[], entraram[], novas[], sairam[] }.

Uso (na pasta agendamento_evo, com o .env da unidade):
    .venv/bin/python run_ativas_foto.py
"""
import json
import os
import sys
from datetime import date, datetime, timezone, timedelta

try:
    from evo_agendamento import EvoClient
except Exception as e:  # pragma: no cover
    print(f"[ERRO] não consegui importar o pacote evo_agendamento: {e}")
    sys.exit(1)

ATIVOS = ("active", "suspended")  # trancada = ativa
ARQ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "alunas-ativas-historico.json"))


def hoje_sp():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date().isoformat()


TOLERANCIA_DIAS = 7  # renovação atrasada até isso = continua aluna


def _d(s):
    try:
        return datetime.fromisoformat(str(s)[:19]).date()
    except Exception:
        return None


def _fim_efetivo(m):
    fim = _d(m.get("endDate"))
    c = _d(m.get("cancelDate"))
    if c and (not fim or c < fim):
        fim = c
    return fim


def reconstruir(rows, hoje):
    """Série diária de ativas / entraram / novas / saíram pelos contratos."""
    pessoas = []
    for m in rows:
        iv = []
        for x in (m.get("memberships") or []):
            ini, fim = _d(x.get("startDate")), _fim_efetivo(x)
            if not ini:
                continue
            if fim is None:
                fim = hoje
            if fim >= ini:
                iv.append([ini, fim])
        if not iv:
            continue
        iv.sort()
        junt = [iv[0]]
        for a, b in iv[1:]:
            if a <= junt[-1][1] + timedelta(days=TOLERANCIA_DIAS + 1):
                junt[-1][1] = max(junt[-1][1], b)
            else:
                junt.append([a, b])
        pessoas.append(junt)
    if not pessoas:
        return None
    inicio = min(p[0][0] for p in pessoas)
    n = (hoje - inicio).days + 1
    delta, entr, novas, sai = [0] * (n + 1), [0] * n, [0] * n, [0] * n
    for junt in pessoas:
        for k, (a, b) in enumerate(junt):
            if a > hoje:
                continue
            ia, ib = (a - inicio).days, (min(b, hoje) - inicio).days
            delta[ia] += 1
            delta[ib + 1] -= 1
            entr[ia] += 1
            if k == 0:
                novas[ia] += 1
            if b < hoje:
                sai[ib + 1] += 1
    ativas, acc = [], 0
    for i in range(n):
        acc += delta[i]
        ativas.append(acc)
    return {"inicio": inicio.isoformat(), "ativas": ativas, "entraram": entr, "novas": novas, "sairam": sai,
            "tolerancia": TOLERANCIA_DIAS}


def main():
    evo = EvoClient()
    ativas, trancadas, take, skip = set(), set(), 100, 0
    todos = []
    for _ in range(200):
        rows = evo._request("GET", "/api/v1/members", params={"take": take, "skip": skip}) or []
        if not isinstance(rows, list) or not rows:
            break
        todos.extend(rows)
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
    try:
        rec = reconstruir(todos, date.fromisoformat(dia))
        if rec:
            h["reconstruido"] = rec
    except Exception as e:  # o histórico é um bônus: falha nele não perde a foto
        print(f"[aviso] reconstrução do histórico falhou: {e}")
    os.makedirs(os.path.dirname(ARQ), exist_ok=True)
    tmp = ARQ + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(h, f, ensure_ascii=False)
    os.replace(tmp, ARQ)
    extra = f" · entraram {entraram} · saíram {sairam}" if base else " · primeira foto (entradas/saídas a partir de amanhã)"
    rec = h.get("reconstruido") or {}
    hist = f" · histórico desde {rec.get('inicio')} (hoje pelos contratos: {rec['ativas'][-1]})" if rec.get("ativas") else ""
    print(f"foto de alunas ativas {dia}: {len(ativas)} ativas ({len(trancadas)} trancadas){extra}{hist}")


if __name__ == "__main__":
    main()
