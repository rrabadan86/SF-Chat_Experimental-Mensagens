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

CONTRATOS IGNORADOS: CIRCUITO e VIP não contam — quem só tem esse contrato não
é aluna ativa. Padrão: nome com "circuito" ou "vip"; outra lista no .env:
ATIVAS_IGNORAR_CONTRATOS=circuito,vip,avulso (separado por vírgula).
Contrato NA FILA (renovação que ainda não começou) também não conta.

LISTA DE ALUNAS (para a tela mostrar quem são): "pessoas" { id: { n: nome,
iv: [[início, fim]…], c: contrato, t: trancada } }. A lista do EVO só traz o
1º nome; o nome completo das ativas vem do detalhe (no máx. --nomes por vez,
guardado em "nomes" — o EVO limita 40 chamadas/min).

Uso (na pasta agendamento_evo, com o .env da unidade):
    .venv/bin/python run_ativas_foto.py
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import date, datetime, timezone, timedelta

try:
    from evo_agendamento import EvoClient
except Exception as e:  # pragma: no cover
    print(f"[ERRO] não consegui importar o pacote evo_agendamento: {e}")
    sys.exit(1)

ATIVOS = ("active", "suspended")  # trancada = ativa
IGNORAR = [x.strip() for x in os.getenv("ATIVAS_IGNORAR_CONTRATOS", "circuito,vip").split(",") if x.strip()]
ARQ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "alunas-ativas-historico.json"))


def hoje_sp():
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date().isoformat()


TOLERANCIA_DIAS = 7  # renovação atrasada até isso = continua aluna


def _d(s):
    try:
        return datetime.fromisoformat(str(s)[:19]).date()
    except Exception:
        return None


def _norm(s):
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()


def ignorado(x):
    """Contrato que não conta (ex.: circuito)."""
    n = _norm(x.get("name"))
    # começo de palavra: "vip" pega "VIP NOVO", mas não pega no meio de outra palavra
    return any(re.search(r"(?<![a-z0-9])" + re.escape(_norm(i)), n) for i in IGNORAR)


def _st(x):
    return str((x or {}).get("membershipStatus") or "").strip().lower()


def contrato_vigente(m, hoje):
    """(motivo, contrato, trancada, fila) de uma cliente com status ativo/trancado.
    motivo: "conta" | "ignorado" (só circuito) | "fila" (só contrato que ainda não
    começou — renovação na fila não é contrato vigente) | "sem" (nenhum vigente).
    fila = (nome, início) do próximo contrato na fila, se houver."""
    lst = m.get("memberships") or []
    if not lst:  # sem os contratos na lista: confia no status do EVO
        return "conta", "", _st(m) == "suspended", None

    def vale(x):
        ini, fim = _d(x.get("startDate")), _fim_efetivo(x)
        return bool(ini) and ini <= hoje and (fim is None or fim >= hoje or _st(x) in ATIVOS)

    futuros = sorted((x for x in lst if not ignorado(x) and _d(x.get("startDate")) and _d(x.get("startDate")) > hoje),
                     key=lambda x: str(x.get("startDate")))
    fila = ((futuros[0].get("name") or "").strip(), str(futuros[0].get("startDate"))[:10]) if futuros else None
    bons = [x for x in lst if not ignorado(x) and vale(x)]
    if not bons:
        ign = [x for x in lst if ignorado(x) and vale(x)]
        if ign:
            return "ignorado", (ign[0].get("name") or "").strip(), False, None
        return ("fila" if fila else "sem"), (fila[0] if fila else ""), False, None
    bons.sort(key=lambda x: str(x.get("startDate") or ""), reverse=True)
    c = bons[0]
    tranc = _st(m) == "suspended" or _st(c) == "suspended"
    return "conta", (c.get("name") or "").strip(), tranc, fila


def _fim_efetivo(m):
    fim = _d(m.get("endDate"))
    c = _d(m.get("cancelDate"))
    if c and (not fim or c < fim):
        fim = c
    return fim


def reconstruir(rows, hoje, por_id=None):
    """Série diária de ativas / entraram / novas / saíram pelos contratos.
    `por_id` (opcional) recebe { id: [[início, fim]…] } de cada pessoa."""
    pessoas = []
    for m in rows:
        iv = []
        for x in (m.get("memberships") or []):
            if ignorado(x):
                continue
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
        if por_id is not None and m.get("idMember") is not None:
            por_id[str(m.get("idMember"))] = [[a.isoformat(), b.isoformat()] for a, b in junt if a <= hoje]
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--nomes", type=int, default=30, help="quantos nomes completos buscar no EVO nesta vez (padrão 30)")
    args = ap.parse_args()
    evo = EvoClient()
    ativas, trancadas, take, skip = set(), set(), 100, 0
    todos, info, so_ignorado, fora = [], {}, {}, {"fila": 0, "sem": 0}
    hoje = date.fromisoformat(hoje_sp())
    vistos = set()
    for _ in range(200):
        rows = evo._request("GET", "/api/v1/members", params={"take": take, "skip": skip}) or []
        if not isinstance(rows, list) or not rows:
            break
        novos = [m for m in rows if str(m.get("idMember")) not in vistos]  # paginação pode repetir
        vistos.update(str(m.get("idMember")) for m in novos)
        todos.extend(novos)
        for m in novos:
            st = str(m.get("membershipStatus") or "").strip().lower()
            idm = m.get("idMember")
            if idm is not None and st in ATIVOS:
                motivo, contrato, tranc, fila = contrato_vigente(m, hoje)
                if motivo == "ignorado":
                    so_ignorado[contrato] = so_ignorado.get(contrato, 0) + 1
                if motivo != "conta":
                    fora[motivo] = fora.get(motivo, 0) + 1
                    continue
                ativas.add(str(idm))
                info[str(idm)] = (contrato, tranc, fila)
                if tranc:
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
    h["ignorados"] = {"regra": IGNORAR, "so_ignorado": so_ignorado, "so_fila": fora["fila"], "sem_vigente": fora["sem"]}
    por_id = {}
    try:
        rec = reconstruir(todos, date.fromisoformat(dia), por_id)
        if rec:
            h["reconstruido"] = rec
    except Exception as e:  # o histórico é um bônus: falha nele não perde a foto
        print(f"[aviso] reconstrução do histórico falhou: {e}")

    # Quem é cada uma (a tela lista as alunas de cada período)
    nomes = h.get("nomes") or {}
    buscados, falhas = 0, 0
    for idm in sorted(ativas - set(nomes)):
        if buscados >= max(0, args.nomes):
            break
        buscados += 1
        try:
            d = evo._request("GET", f"/api/v1/members/{int(idm)}") or {}
            nm = " ".join(x for x in (str(d.get("firstName") or "").strip(), str(d.get("lastName") or "").strip()) if x)
            if nm:
                nomes[idm] = nm
        except Exception:
            falhas += 1
            if falhas >= 3:  # EVO instável: fica para a próxima
                break
    h["nomes"] = nomes
    pessoas = {}
    for m in todos:
        idm = m.get("idMember")
        if idm is None:
            continue
        k = str(idm)
        iv = por_id.get(k)
        if not iv and k not in ativas:
            continue
        p = {"n": nomes.get(k) or str(m.get("firstName") or "").strip() or f"id {k}", "iv": iv or []}
        if k in info:
            p["c"], p["t"] = info[k][0], info[k][1]
            if info[k][2]:
                p["f"] = info[k][2]  # próximo contrato na fila (nome, início)
        pessoas[k] = p
    h["pessoas"] = pessoas
    sem_nome = len(ativas - set(nomes))
    os.makedirs(os.path.dirname(ARQ), exist_ok=True)
    tmp = ARQ + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(h, f, ensure_ascii=False)
    os.replace(tmp, ARQ)
    extra = f" · entraram {entraram} · saíram {sairam}" if base else " · primeira foto (entradas/saídas a partir de amanhã)"
    rec = h.get("reconstruido") or {}
    hist = f" · histórico desde {rec.get('inicio')} (hoje pelos contratos: {rec['ativas'][-1]})" if rec.get("ativas") else ""
    ign = sum(so_ignorado.values())
    ign = f" · {ign} ignorada(s) por só ter contrato {' ou '.join(IGNORAR)}" if ign else ""
    if fora["fila"]:
        ign += f" · {fora['fila']} fora por só ter contrato na fila (ainda não começou)"
    nm = f" · faltam {sem_nome} nomes completos (vêm nas próximas atualizações)" if sem_nome else ""
    print(f"foto de alunas ativas {dia}: {len(ativas)} ativas ({len(trancadas)} trancadas){ign}{extra}{hist}{nm}")


if __name__ == "__main__":
    main()
