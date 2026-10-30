#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO (só LEITURA) — dá para reconstruir o nº de ALUNAS ATIVAS no passado?

Ideia: aluna ativa num dia D = tem um contrato que começou até D e ainda não
tinha terminado/sido cancelado em D. TRANCADA (suspended) conta como ATIVA.
Se o EVO devolver os contratos ANTIGOS (das ex-alunas também) com as datas,
dá para calcular o nº de ativas em qualquer dia — ex.: dezembro/2025.

Este script NÃO muda nada no EVO e NÃO imprime nomes, telefones ou CPF:
só contagens, nomes de campos e datas. Ele:
  1) lista todas as clientes (/api/v1/members, paginado) e conta por status;
  2) mostra quais campos vêm em cada contrato (memberships) e quais têm data;
  3) olha o detalhe de algumas ex-alunas (contratos antigos vêm?);
  4) RECONSTRÓI o nº de ativas de HOJE pelos contratos e compara com o real —
     se bater, o método vale para o passado;
  5) mostra a reconstrução no dia 1º de cada mês (últimos 18 meses).

COMO USAR (na pasta agendamento_evo, com o .env da unidade):
    .venv/bin/python diag_ativas.py
    .venv/bin/python diag_ativas.py --detalhes 30     # olha mais ex-alunas
"""
import argparse
import sys
from collections import Counter
from datetime import date, datetime, timedelta

try:
    from evo_agendamento import EvoClient
except Exception as e:  # pragma: no cover
    print(f"[ERRO] não consegui importar o pacote evo_agendamento: {e}")
    sys.exit(1)

ATIVOS = ("active", "suspended")  # trancada = ativa


def _d(s):
    try:
        return datetime.fromisoformat(str(s)[:19]).date()
    except Exception:
        return None


def _st(x):
    return str((x or {}).get("membershipStatus") or "").strip().lower()


def _campos_data(dic):
    return sorted(k for k, v in (dic or {}).items() if v not in (None, "") and ("date" in k.lower() or "data" in k.lower() or "cancel" in k.lower()))


def _fim_efetivo(m):
    """Último dia do contrato: o menor entre o fim previsto e um cancelamento."""
    fim = _d(m.get("endDate"))
    for k in ("cancelDate", "canceledDate", "cancellationDate", "dtCancel", "cancelationDate"):
        c = _d(m.get(k))
        if c and (not fim or c < fim):
            fim = c
    return fim


def ativa_em(contratos, dia):
    for m in contratos:
        ini, fim = _d(m.get("startDate")), _fim_efetivo(m)
        if ini and ini <= dia and (fim is None or fim >= dia):
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detalhes", type=int, default=15, help="quantas ex-alunas olhar no detalhe (padrão 15)")
    args = ap.parse_args()
    evo = EvoClient()
    hoje = date.today()

    # 1) todas as clientes
    todos, take, skip = [], 100, 0
    for _ in range(200):
        rows = evo._request("GET", "/api/v1/members", params={"take": take, "skip": skip}) or []
        if not isinstance(rows, list) or not rows:
            break
        todos.extend(rows)
        if len(rows) < take:
            break
        skip += take
    print(f"\n═══ 1) CLIENTES NO EVO: {len(todos)} ═══")
    print("   por status:", dict(Counter(_st(m) or "(vazio)" for m in todos)))
    ativas_reais = sum(1 for m in todos if _st(m) in ATIVOS)
    print(f"   ativas hoje (active + trancadas): {ativas_reais}")
    if not todos:
        return

    # 2) campos dos contratos que vêm na lista
    com_lista = [m for m in todos if isinstance(m.get("memberships"), list) and m.get("memberships")]
    print(f"\n═══ 2) CONTRATOS NA LISTA ═══")
    print(f"   clientes com 'memberships' na própria lista: {len(com_lista)} de {len(todos)}")
    print("   campos do cadastro (lista):", ", ".join(sorted(todos[0].keys())))
    exemplo = next((m["memberships"][0] for m in com_lista), None) or next((m.get("membership") for m in todos if isinstance(m.get("membership"), dict)), None)
    if exemplo:
        print("   campos de um contrato:", ", ".join(sorted(exemplo.keys())))
        print("   campos de DATA/cancelamento preenchidos:", ", ".join(_campos_data(exemplo)) or "(nenhum)")
    nc = Counter(len(m.get("memberships") or []) for m in todos)
    print("   nº de contratos por cliente (na lista):", dict(sorted(nc.items())[:10]))

    # 3) detalhe de algumas ex-alunas
    ex = [m for m in todos if _st(m) and _st(m) not in ATIVOS][: max(0, args.detalhes)]
    print(f"\n═══ 3) DETALHE DE {len(ex)} EX-ALUNAS (contratos antigos vêm?) ═══")
    det_contratos, chaves_cancel = 0, Counter()
    for m in ex:
        idm = m.get("idMember")
        try:
            d = evo._request("GET", f"/api/v1/members/{int(idm)}") or {}
        except Exception as e:
            print(f"   (id {idm}: erro {e})")
            continue
        lst = d.get("memberships") or []
        det_contratos += len(lst)
        datas = [(str(x.get("startDate"))[:10], str(x.get("endDate"))[:10], _st(x)) for x in lst][:4]
        for x in lst:
            for k in _campos_data(x):
                if "cancel" in k.lower():
                    chaves_cancel[k] += 1
        print(f"   ex-aluna {idm}: {len(lst)} contrato(s) {datas}")
    print(f"   total de contratos nesses detalhes: {det_contratos}")
    print("   campos de cancelamento vistos:", dict(chaves_cancel) or "(nenhum)")

    # 4) reconstrução de HOJE pelos contratos (validação)
    base = {m.get("idMember"): (m.get("memberships") or ([m["membership"]] if isinstance(m.get("membership"), dict) else [])) for m in todos}
    tem_contrato = sum(1 for v in base.values() if v)
    rec_hoje = sum(1 for v in base.values() if ativa_em(v, hoje))
    print(f"\n═══ 4) VALIDAÇÃO (só com os contratos que vêm na lista) ═══")
    print(f"   clientes com algum contrato com data: {tem_contrato}")
    print(f"   ativas HOJE reconstruídas pelas datas: {rec_hoje}  ×  ativas reais: {ativas_reais}")
    if ativas_reais:
        dif = rec_hoje - ativas_reais
        print(f"   diferença: {dif:+d} ({dif * 100 / ativas_reais:+.1f}%)")

    # 5) reconstrução mês a mês
    print("\n═══ 5) ATIVAS NO DIA 1º DE CADA MÊS (reconstruído) ═══")
    inicio_min = min((_d(x.get("startDate")) for v in base.values() for x in v if _d(x.get("startDate"))), default=None)
    print(f"   contrato mais antigo encontrado: {inicio_min}")
    d = date(hoje.year, hoje.month, 1)
    meses = []
    for _ in range(18):
        meses.append(d)
        d = (d - timedelta(days=1)).replace(day=1)
    for m in reversed(meses):
        print(f"   {m.strftime('%m/%Y')}: {sum(1 for v in base.values() if ativa_em(v, m))}")
    print("\nPronto. Copie TODA esta saída e mande no chat.")


if __name__ == "__main__":
    main()
