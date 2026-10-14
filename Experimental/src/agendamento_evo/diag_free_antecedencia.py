#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO (só LEITURA) — Antecedência de marcação dos planos FREE (GRUPO 2).

Regra do negócio: a aluna de plano FREE … GRUPO 2 só pode marcar a aula com, no
MÁXIMO, 1 dia de antecedência (hoje 14 → pode marcar para 15; NÃO pode 16+).
O app antigo deixa ela marcar qualquer dia, então precisamos achar (e depois
desmarcar) as marcações feitas com 2+ dias de antecedência.

IMPORTANTE: só conta quem tem o plano FREE/GRUPO 2 **ATIVO** (membershipStatus
== "active"). Contrato FREE antigo que já foi cancelado/expirado NÃO conta —
senão quem já foi FREE e hoje tem plano pago (ex.: Fernanda, Duanny) apareceria
por engano.

Este script NÃO desmarca nada. Ele:
  1) varre a grade de (hoje+2) até (hoje+N dias);
  2) em cada turma, lê os `enrollments` (quem está matriculado);
  3) para cada ALUNA (idMember), lê o cadastro e pega os contratos ATIVOS;
  4) mostra quem SERIA desmarcada (plano FREE/GRUPO 2 ATIVO, 2+ dias de
     antecedência) e lista os contratos ATIVOS vistos, pra confirmar o critério.

COMO USAR (dentro da pasta agendamento_evo, com o .env da unidade):
    python diag_free_antecedencia.py                 # janela padrão: hoje+2 a hoje+4
    python diag_free_antecedencia.py --dias 10
    python diag_free_antecedencia.py --dump-membro 5310   # vê o cadastro cru de 1 aluna
"""
import argparse
import json
import sys
from datetime import timedelta

try:
    from evo_agendamento import EvoClient
    from evo_agendamento.util import agora_brasilia
    # Reusa as MESMAS regras/critério do job (editáveis no painel).
    from evo_agendamento.free_antecedencia import eh_free_grupo2 as _eh_free_grupo2
    from evo_agendamento.free_antecedencia import carregar_regras as _carregar_regras
except Exception as e:  # pragma: no cover
    print(f"[ERRO] não consegui importar o pacote evo_agendamento: {e}")
    sys.exit(1)


def _norm(s):
    return str(s or "").strip().lower()


def _contrato_ativo(m):
    """Contrato ATIVO = membershipStatus 'active'. (expired/canceled não contam.)"""
    return _norm(m.get("membershipStatus")) == "active"


def _contratos_ativos(reg):
    """Lista de nomes dos contratos ATIVOS da aluna (sem os cancelados/expirados).
    Olha a lista `memberships` e também o `membership` singular (contrato primário)."""
    nomes = []
    vistos = set()
    for m in (reg.get("memberships") or []):
        if _contrato_ativo(m):
            nome = str(m.get("name") or "").strip()
            if nome and nome.lower() not in vistos:
                vistos.add(nome.lower())
                nomes.append(nome)
    prim = reg.get("membership") or {}
    if _contrato_ativo(prim):
        nome = str(prim.get("name") or "").strip()
        if nome and nome.lower() not in vistos:
            vistos.add(nome.lower())
            nomes.append(nome)
    return nomes


def _free_ativos(reg):
    """Nomes dos contratos ATIVOS que são FREE/GRUPO 2."""
    return [n for n in _contratos_ativos(reg) if _eh_free_grupo2(n)]


def _hora_turma(t):
    import re
    s = str(t.get("startTime") or t.get("time") or t.get("hour") or "")
    m = re.search(r"(\d{1,2}:\d{2})", s)
    return m.group(1) if m else ""


def _enroll_ativa(en):
    """A matrícula está ATIVA (ocupa vaga) — não cancelada/falta justificada/removida."""
    return (en.get("status") != 2 and not en.get("justifiedAbsence")
            and not en.get("removed") and not en.get("suspended"))


def _buscar_membro(evo, id_member):
    """Traz o cadastro da aluna (com a lista de contratos). Só LEITURA."""
    try:
        data = evo._request("GET", f"/api/v1/members/{int(id_member)}")
    except Exception:
        data = None
    if isinstance(data, list):
        data = data[0] if data else None
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=4,
                    help="quantos dias à frente varrer a grade (padrão 4 = hoje+2 até hoje+4)")
    ap.add_argument("--dump-membro", type=int, default=None,
                    help="imprime o cadastro cru de UMA aluna (idMember) e sai")
    args = ap.parse_args()

    evo = EvoClient()

    if args.dump_membro:
        reg = _buscar_membro(evo, args.dump_membro)
        print(json.dumps(reg, indent=2, ensure_ascii=False) if reg else "(nada)")
        if reg:
            print("\n→ contratos ATIVOS:", _contratos_ativos(reg) or "(nenhum)")
            print("→ FREE/GRUPO 2 ativos:", _free_ativos(reg) or "(nenhum)")
        return

    hoje = agora_brasilia().date()
    limite_ok = hoje + timedelta(days=1)   # marcação permitida: só até amanhã
    inicio = hoje + timedelta(days=2)      # a partir daqui é violação (2+ dias)
    fim = hoje + timedelta(days=args.dias)

    print(f"🔎 DIAG FREE/antecedência — hoje={hoje:%d/%m/%Y}  "
          f"permitido até {limite_ok:%d/%m/%Y}  |  varrendo {inicio:%d/%m} → {fim:%d/%m}")
    print(f"   regras de plano (painel): {[', '.join(r) for r in _carregar_regras()]} E contrato ATIVO")
    print("   (só LEITURA — não desmarca nada)\n")

    cache = {}
    violacoes = []          # [{data, hora, nome, idMember, plano}]
    ativos_vistos = {}      # nome_contrato_ativo -> contagem (de alunas distintas)
    membros_contados = set()
    sem_contrato = []       # idMembers sem contrato ativo encontrado
    total_turmas = 0
    total_matriculas = 0

    d = inicio
    while d <= fim:
        ds = d.strftime("%Y-%m-%d")
        try:
            turmas = evo.list_schedule(ds, show_full_week=False, only_availables=False) or []
        except Exception as e:
            print(f"   ⚠️  {d:%d/%m}: falha ao ler a grade: {e}")
            d += timedelta(days=1)
            continue
        print(f"   … {d:%d/%m}: {len(turmas)} turma(s) — lendo matrículas", flush=True)
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
                if idm not in cache:
                    reg = _buscar_membro(evo, idm)
                    cache[idm] = {
                        "ativos": _contratos_ativos(reg) if reg else [],
                        "free": _free_ativos(reg) if reg else [],
                        "achou": bool(reg),
                    }
                info = cache[idm]
                if idm not in membros_contados:
                    membros_contados.add(idm)
                    if not info["achou"] or not info["ativos"]:
                        sem_contrato.append((idm, en.get("name")))
                    for nome in info["ativos"]:
                        ativos_vistos[nome] = ativos_vistos.get(nome, 0) + 1
                if info["free"]:
                    violacoes.append({
                        "data": ds, "hora": hora, "nome": en.get("name"),
                        "idMember": idm, "plano": info["free"][0],
                    })
        d += timedelta(days=1)

    print(f"\n📊 Varredura: {total_turmas} turma(s) lidas, {total_matriculas} matrícula(s) ativa(s), "
          f"{len(membros_contados)} aluna(s) distinta(s).\n")

    print("── CONTRATOS ATIVOS VISTOS (confira o critério FREE/GRUPO 2) ──")
    if ativos_vistos:
        for nome, qtd in sorted(ativos_vistos.items(), key=lambda x: (-x[1], x[0])):
            tag = "  ← FREE/GRUPO 2 ✅" if _eh_free_grupo2(nome) else ""
            print(f"   {qtd:>3}×  {nome}{tag}")
    else:
        print("   ⚠️  nenhum contrato ativo extraído — rode --dump-membro <id> p/ investigar.")
    print()

    if sem_contrato:
        print(f"⚠️  {len(sem_contrato)} aluna(s) sem contrato ATIVO identificado (ex.: "
              + ", ".join(f"{n or '?'}#{i}" for i, n in sem_contrato[:5]) + " …)\n")

    print("── SERIAM DESMARCADAS (FREE/GRUPO 2 ATIVO, 2+ dias de antecedência) ──")
    if not violacoes:
        print("   ✅ nenhuma marcação FREE irregular na janela.")
    else:
        violacoes.sort(key=lambda v: (v["data"], v["hora"]))
        for v in violacoes:
            dd = v["data"][8:10] + "/" + v["data"][5:7]
            print(f"   ❌ {dd} {v['hora'] or '--:--'}  {v['nome']}  (idMember={v['idMember']})")
            print(f"        plano ATIVO: {v['plano']}")
        print(f"\n   Total: {len(violacoes)} marcação(ões) seriam desmarcadas.")
    print()


if __name__ == "__main__":
    main()
