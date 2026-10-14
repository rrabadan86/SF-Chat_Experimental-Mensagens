# -*- coding: utf-8 -*-
"""
Antecedência de marcação dos planos FREE (GRUPO 2).

Regra: a aluna de plano FREE … GRUPO 2 só pode marcar a aula com, no MÁXIMO,
1 dia de antecedência (hoje 14 → pode 15; NÃO pode 16+). O app antigo deixa ela
marcar qualquer dia, então este módulo varre a grade de (hoje+2) em diante e
desmarca as marcações feitas com 2+ dias de antecedência.

Só conta quem tem o plano FREE/GRUPO 2 **ATIVO** (membershipStatus == "active").
Contrato FREE antigo (cancelado/expirado) NÃO conta — senão quem já foi FREE e
hoje tem plano pago apareceria por engano.

Desmarca via change_session_status(status=2) — "falta justificada": libera a
vaga, é reversível e preserva a sessão da aluna (ela pode remarcar p/ até amanhã).
É o mesmo mecanismo que a SoFIA usa na desmarcação de experimental.
"""
import os
from datetime import timedelta

from . import config
from .evo_client import EvoClient
from .util import agora_brasilia

import logging
log = logging.getLogger(__name__)

# Critério dos planos que entram, EDITÁVEL NO PAINEL. Guardado em
# data/free-antecedencia-planos.txt: UMA regra por linha; os termos de cada linha
# separados por vírgula; o plano entra se o nome contém TODOS os termos de ALGUMA
# linha (linhas = OU; termos da mesma linha = E). Linha começando com # é comentário.
# Padrão (arquivo ausente/vazio): "free, 3x, grupo 2" — pega os 4 planos FREE 3X
# GRUPO 2 e deixa de fora os FREE 5X (que NÃO têm a regra de antecedência).
_PLANOS_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data",
                            "free-antecedencia-planos.txt")
_REGRAS_PADRAO = [["free", "3x", "grupo 2"]]


def _norm(s):
    return str(s or "").strip().lower()


def carregar_regras():
    """Lê as regras do arquivo (editável no painel). Cada regra é uma lista de
    termos (substrings em minúsculo) que precisam TODOS estar no nome do plano."""
    try:
        with open(_PLANOS_FILE, encoding="utf-8") as f:
            regras = []
            for linha in f:
                linha = linha.strip()
                if not linha or linha.startswith("#"):
                    continue
                termos = [t.strip().lower() for t in linha.split(",") if t.strip()]
                if termos:
                    regras.append(termos)
            if regras:
                return regras
    except (OSError, ValueError):
        pass
    return _REGRAS_PADRAO


def eh_free_grupo2(nome_plano, regras=None):
    n = _norm(nome_plano)
    for termos in (regras if regras is not None else carregar_regras()):
        if all(t in n for t in termos):
            return True
    return False


def _contrato_ativo(m):
    return _norm(m.get("membershipStatus")) == "active"


def contratos_ativos(reg):
    """Nomes dos contratos ATIVOS da aluna (sem cancelados/expirados)."""
    nomes, vistos = [], set()
    for m in (reg.get("memberships") or []):
        if _contrato_ativo(m):
            nome = str(m.get("name") or "").strip()
            if nome and nome.lower() not in vistos:
                vistos.add(nome.lower()); nomes.append(nome)
    prim = reg.get("membership") or {}
    if _contrato_ativo(prim):
        nome = str(prim.get("name") or "").strip()
        if nome and nome.lower() not in vistos:
            vistos.add(nome.lower()); nomes.append(nome)
    return nomes


def free_ativos(reg, regras=None):
    """Nomes dos contratos ATIVOS que batem com as regras de planos (FREE/GRUPO 2)."""
    return [n for n in contratos_ativos(reg) if eh_free_grupo2(n, regras)]


def _hora_turma(t):
    import re
    s = str(t.get("startTime") or t.get("time") or t.get("hour") or "")
    m = re.search(r"(\d{1,2}:\d{2})", s)
    return m.group(1) if m else ""


def _enroll_ativa(en):
    """Matrícula ATIVA (ocupa vaga) — não cancelada/falta justificada/removida."""
    return (en.get("status") != 2 and not en.get("justifiedAbsence")
            and not en.get("removed") and not en.get("suspended"))


def _buscar_membro(evo, id_member):
    """Cadastro da aluna (com a lista de contratos). Tenta 2x p/ driblar 429."""
    for tentativa in (1, 2):
        try:
            data = evo._request("GET", f"/api/v1/members/{int(id_member)}")
        except Exception as e:
            if tentativa == 2:
                log.warning("free: falha ao ler cadastro do idMember=%s (%s)", id_member, e)
                return None
            continue
        if isinstance(data, list):
            data = data[0] if data else None
        return data
    return None


def varrer(evo=None, dias=3, dry=True, branch_id=None):
    """Varre de hoje+2 até hoje+(1+dias) e acha as marcações FREE/GRUPO 2 ATIVAS
    feitas com 2+ dias de antecedência. Se dry=False, desmarca cada uma (status=2).

    `dias` = quantos dias varrer a partir de hoje+2 (padrão 3 → hoje+2, +3, +4;
    ex.: hoje 14 → 16, 17, 18).

    Retorna dict: {hoje, inicio, fim, dry, turmas, matriculas, alunas, itens, sem_contrato}.
    Cada item: {idMember, nome, data (yyyy-MM-dd), hora, plano, idConfiguration,
    desmarcada (bool|None), erro (str|None)}. None em desmarcada = modo dry.
    """
    evo = evo or EvoClient()
    hoje = agora_brasilia().date()
    inicio = hoje + timedelta(days=2)
    fim = hoje + timedelta(days=max(1, int(dias)) + 1)   # dias=3 → +2..+4

    regras = carregar_regras()   # lê 1x por rodada (editável no painel)
    cache = {}
    itens = []
    alunas = set()
    sem_contrato = []
    total_turmas = 0
    total_matriculas = 0

    d = inicio
    while d <= fim:
        ds = d.strftime("%Y-%m-%d")
        try:
            turmas = evo.list_schedule(ds, show_full_week=False, only_availables=False) or []
        except Exception as e:
            log.warning("free: falha ao ler a grade de %s (%s)", ds, e)
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
                    continue  # pula leads (idProspect) e matrículas já canceladas
                total_matriculas += 1
                if idm not in cache:
                    reg = _buscar_membro(evo, idm)
                    cache[idm] = {
                        "free": free_ativos(reg, regras) if reg else [],
                        "ativos": contratos_ativos(reg) if reg else [],
                        "achou": bool(reg),
                    }
                info = cache[idm]
                if idm not in alunas:
                    alunas.add(idm)
                    if not info["achou"] or not info["ativos"]:
                        sem_contrato.append({"idMember": idm, "nome": en.get("name")})
                if not info["free"]:
                    continue
                item = {
                    "idMember": idm, "nome": en.get("name"),
                    "data": ds, "hora": hora, "plano": info["free"][0],
                    "idConfiguration": idc, "desmarcada": None, "erro": None,
                }
                if not dry:
                    try:
                        evo.change_session_status(status=2, id_member=idm,
                                                  id_configuration=idc, activity_date=ds,
                                                  branch_id=branch_id)
                        item["desmarcada"] = True
                        log.info("free: desmarcada %s (idMember=%s) %s %s — %s",
                                 en.get("name"), idm, ds, hora, info["free"][0])
                    except Exception as e:
                        item["desmarcada"] = False
                        item["erro"] = str(e)
                        log.warning("free: FALHA ao desmarcar idMember=%s %s %s: %s",
                                    idm, ds, hora, e)
                itens.append(item)
        d += timedelta(days=1)

    itens.sort(key=lambda x: (x["data"], x["hora"] or "", x["nome"] or ""))
    return {
        "hoje": hoje.strftime("%Y-%m-%d"),
        "inicio": inicio.strftime("%Y-%m-%d"),
        "fim": fim.strftime("%Y-%m-%d"),
        "dry": bool(dry),
        "regras": [", ".join(r) for r in regras],
        "turmas": total_turmas,
        "matriculas": total_matriculas,
        "alunas": len(alunas),
        "itens": itens,
        "sem_contrato": sem_contrato,
    }
