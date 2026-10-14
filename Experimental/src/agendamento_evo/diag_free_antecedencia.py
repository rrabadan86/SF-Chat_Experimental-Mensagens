#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO (só LEITURA) — Antecedência de marcação dos planos FREE (GRUPO 2).

Regra do negócio: a aluna de plano FREE … GRUPO 2 só pode marcar a aula com, no
MÁXIMO, 1 dia de antecedência (hoje 14 → pode marcar para 15; NÃO pode 16+).
O app antigo deixa ela marcar qualquer dia, então precisamos achar (e depois
desmarcar) as marcações feitas com 2+ dias de antecedência.

Este script NÃO desmarca nada. Ele:
  1) varre a grade de (hoje+2) até (hoje+N dias);
  2) em cada turma, lê os `enrollments` (quem está matriculado);
  3) para cada ALUNA (idMember) marcada, descobre o PLANO dela;
  4) mostra quem SERIA desmarcada (FREE … GRUPO 2 marcada com 2+ dias) e lista
     TODOS os planos distintos vistos, pra confirmarmos o critério de match.

COMO USAR (dentro da pasta agendamento_evo, com o .env da unidade):
    python diag_free_antecedencia.py                 # janela padrão: 21 dias
    python diag_free_antecedencia.py --dias 30
    python diag_free_antecedencia.py --dump-membro 12345   # vê o JSON cru de 1 aluna
    python diag_free_antecedencia.py --full                # dump cru das 1as alunas (achar o campo do plano)
"""
import argparse
import json
import sys
from datetime import timedelta

try:
    from evo_agendamento import EvoClient
    from evo_agendamento.util import agora_brasilia
except Exception as e:  # pragma: no cover
    print(f"[ERRO] não consegui importar o pacote evo_agendamento: {e}")
    sys.exit(1)


# Critério de FREE … GRUPO 2: o nome do plano precisa conter TODOS estes termos.
# Pega as 4 variações atuais (RECORRENTE / C.C. / SLIMSUMMER 2026 …) sem fixar os
# nomes exatos — e é fácil de ajustar depois.
FREE_TERMOS = ["free", "grupo 2"]


def _norm(s):
    return str(s or "").strip().lower()


def _eh_free_grupo2(nome_plano):
    n = _norm(nome_plano)
    return all(t in n for t in FREE_TERMOS)


def _hora_turma(t):
    import re
    s = str(t.get("startTime") or t.get("time") or t.get("hour") or "")
    m = re.search(r"(\d{1,2}:\d{2})", s)
    return m.group(1) if m else ""


def _enroll_ativa(en):
    """A matrícula está ATIVA (ocupa vaga) — não cancelada/falta justificada/removida."""
    return (en.get("status") != 2 and not en.get("justifiedAbsence")
            and not en.get("removed") and not en.get("suspended"))


def _coletar_strings_plano(obj, achados, prof=0):
    """Varre o objeto da aluna recursivamente e junta QUALQUER string que tenha
    cara de nome de plano (contém 'grupo', 'slimfit', 'free' ou 'circ'). Serve
    pra descobrir onde o EVO guarda o plano, sem sabermos o nome do campo."""
    if prof > 6:
        return
    if isinstance(obj, dict):
        for v in obj.values():
            _coletar_strings_plano(v, achados, prof + 1)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _coletar_strings_plano(v, achados, prof + 1)
    elif isinstance(obj, str):
        n = obj.lower()
        if any(t in n for t in ("grupo", "slimfit", "free", "circ")) and len(obj) <= 120:
            achados.add(obj.strip())


def _buscar_membro(evo, id_member):
    """Tenta alguns endpoints de cliente/aluna do EVO pra trazer o registro com o
    plano. Retorna (registro|None, endpoint_usado). Só LEITURA."""
    tentativas = [
        ("GET", f"/api/v1/members/{int(id_member)}", None),
        ("GET", "/api/v1/members", {"idMember": int(id_member), "take": 1}),
        ("GET", f"/api/v1/members/{int(id_member)}/memberships", None),
        ("GET", "/api/v1/members/memberships", {"idMember": int(id_member)}),
    ]
    for method, path, params in tentativas:
        try:
            data = evo._request(method, path, params=params)
        except Exception:
            continue
        if not data:
            continue
        reg = data[0] if isinstance(data, list) and data else data
        if reg:
            return reg, f"{method} {path}" + (f" {params}" if params else "")
    return None, None


def _planos_do_membro(evo, id_member, cache, dump=False):
    """Descobre o(s) nome(s) de plano da aluna. Retorna (set_de_planos, endpoint)."""
    if id_member in cache:
        return cache[id_member]
    reg, endpoint = _buscar_membro(evo, id_member)
    planos = set()
    if reg:
        _coletar_strings_plano(reg, planos)
        if dump:
            print("\n----- DUMP CRU DA ALUNA idMember=%s (%s) -----" % (id_member, endpoint))
            print(json.dumps(reg, indent=2, ensure_ascii=False)[:3000])
            print("----- fim do dump -----\n")
    cache[id_member] = (planos, endpoint)
    return cache[id_member]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=21,
                    help="quantos dias à frente varrer a grade (padrão 21)")
    ap.add_argument("--full", action="store_true",
                    help="dump cru das primeiras alunas (ajuda a achar o campo do plano)")
    ap.add_argument("--dump-membro", type=int, default=None,
                    help="imprime o JSON cru de UMA aluna (idMember) e sai")
    args = ap.parse_args()

    evo = EvoClient()

    if args.dump_membro:
        reg, endpoint = _buscar_membro(evo, args.dump_membro)
        print(f"endpoint: {endpoint}")
        print(json.dumps(reg, indent=2, ensure_ascii=False) if reg else "(nada)")
        return

    hoje = agora_brasilia().date()
    limite_ok = hoje + timedelta(days=1)   # marcação permitida: só até amanhã
    inicio = hoje + timedelta(days=2)      # a partir daqui é violação (2+ dias)
    fim = hoje + timedelta(days=args.dias)

    print(f"🔎 DIAG FREE/antecedência — hoje={hoje:%d/%m/%Y}  "
          f"permitido até {limite_ok:%d/%m/%Y}  |  varrendo {inicio:%d/%m} → {fim:%d/%m}")
    print(f"   critério de plano FREE: nome contém {FREE_TERMOS}")
    print("   (só LEITURA — não desmarca nada)\n")

    cache = {}
    violacoes = []          # [{data, hora, nome, idMember, plano}]
    planos_vistos = {}      # nome_plano -> contagem
    sem_plano = []          # idMembers cujo plano não foi encontrado
    total_turmas = 0
    total_matriculas = 0

    d = inicio
    primeiras_dump = 0
    while d <= fim:
        ds = d.strftime("%Y-%m-%d")
        try:
            turmas = evo.list_schedule(ds, show_full_week=False, only_availables=False) or []
        except Exception as e:
            print(f"   ⚠️  {ds}: falha ao ler a grade: {e}")
            d += timedelta(days=1)
            continue
        for t in turmas:
            idc = t.get("idConfiguration")
            if not idc:
                continue
            try:
                det = evo.schedule_detail(id_configuration=idc, activity_date=ds) or {}
            except Exception:
                continue
            total_turmas += 1
            hora = _hora_turma(t) or _hora_turma(det)
            for en in (det.get("enrollments") or []):
                idm = en.get("idMember")
                if not idm or not _enroll_ativa(en):
                    continue  # pula leads (idProspect) e matrículas canceladas
                total_matriculas += 1
                dump = args.full and primeiras_dump < 3
                planos, endpoint = _planos_do_membro(evo, idm, cache, dump=dump)
                if dump:
                    primeiras_dump += 1
                if not planos:
                    sem_plano.append((idm, en.get("name")))
                for p in planos:
                    planos_vistos[p] = planos_vistos.get(p, 0) + 1
                if any(_eh_free_grupo2(p) for p in planos):
                    plano_free = next(p for p in planos if _eh_free_grupo2(p))
                    violacoes.append({
                        "data": ds, "hora": hora, "nome": en.get("name"),
                        "idMember": idm, "plano": plano_free,
                    })
        d += timedelta(days=1)

    print(f"\n📊 Varredura: {total_turmas} turma(s) lidas, {total_matriculas} matrícula(s) ativa(s).\n")

    print("── PLANOS DISTINTOS VISTOS (confira se o critério FREE/GRUPO 2 está certo) ──")
    if planos_vistos:
        for nome, qtd in sorted(planos_vistos.items(), key=lambda x: (-x[1], x[0])):
            tag = "  ← FREE/GRUPO 2 ✅" if _eh_free_grupo2(nome) else ""
            print(f"   {qtd:>3}×  {nome}{tag}")
    else:
        print("   ⚠️  NENHUM nome de plano foi extraído dos cadastros.")
        print("       → rode com --full pra ver o JSON cru da aluna e achar o campo do plano.")
    print()

    if sem_plano:
        print(f"⚠️  {len(sem_plano)} matrícula(s) sem plano identificado (ex.: "
              + ", ".join(f"{n or '?'}#{i}" for i, n in sem_plano[:5]) + " …)")
        print("    → se houver FREE entre elas, precisamos ajustar o lookup do plano.\n")

    print("── SERIAM DESMARCADAS (FREE/GRUPO 2 com 2+ dias de antecedência) ──")
    if not violacoes:
        print("   ✅ nenhuma marcação FREE irregular na janela.")
    else:
        violacoes.sort(key=lambda v: (v["data"], v["hora"]))
        for v in violacoes:
            dd = v["data"][8:10] + "/" + v["data"][5:7]
            print(f"   ❌ {dd} {v['hora'] or '--:--'}  {v['nome']}  (idMember={v['idMember']})")
            print(f"        plano: {v['plano']}")
        print(f"\n   Total: {len(violacoes)} marcação(ões) seriam desmarcadas.")
    print()


if __name__ == "__main__":
    main()
