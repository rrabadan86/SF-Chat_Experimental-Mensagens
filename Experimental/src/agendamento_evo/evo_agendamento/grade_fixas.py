# -*- coding: utf-8 -*-
"""
Grade de MATRÍCULAS FIXAS por turma (previsibilidade de vaga pra matrícula).

Mostra, por turma/horário, as alunas MATRICULADAS DE FORMA FIXA — contadas
INDEPENDENTE de faltarem no dia — e a vaga restante pra matrícula.

Fica de FORA:
  • experimentais (idProspect, sem idMember);
  • REPOSIÇÕES (enrollment.replacement == true) — quem veio repor aula de outro horário;
  • planos FREE (marcam de passagem, não são fixas) — mesmo critério editável do job
    de antecedência (free_antecedencia / data/free-antecedencia-planos.txt);
  • removidas da turma (enrollment.removed == true).

A FALTA (status / justifiedAbsence) NÃO exclui a fixa: o lugar é dela mesmo faltando.

Como ler o plano de cada aluna é 1 chamada por idMember (limite do EVO), guardamos
um cache (data/grade-membros-cache.json, TTL 7 dias) — a 1ª geração é lenta, as
seguintes são rápidas (só consulta quem é novo).
"""
import json
import os
import time
from datetime import timedelta
import logging

from . import config
from .evo_client import EvoClient
from .util import agora_brasilia, session_start_datetime
from .orchestrator import _match_activity
from .free_antecedencia import (carregar_regras, contratos_ativos, free_ativos,
                                _buscar_membro, _norm)

log = logging.getLogger(__name__)

_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data",
                           "grade-membros-cache.json")
_CACHE_TTL = 7 * 24 * 3600   # 7 dias


def _prof(s):
    """Nome da professora da turma (best-effort — varia o campo entre contas EVO)."""
    for k in ("instructorName", "employeeName", "teacherName", "professor",
              "professorName", "nameEmployee", "instructor", "teacher"):
        v = s.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):
            nome = str(v.get("name") or v.get("firstName") or "").strip()
            if nome:
                return nome
    return ""


def _carregar_cache():
    try:
        with open(_CACHE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        agora = time.time()
        return {int(k): v for k, v in d.items()
                if isinstance(v, dict) and (agora - float(v.get("ts", 0))) < _CACHE_TTL}
    except Exception:
        return {}


def _salvar_cache(cache):
    try:
        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    except Exception as e:
        log.warning("grade: falha ao salvar cache de membros (%s)", e)


def _plano_membro(evo, idm, regras, cache):
    """{achou, ativos:[nomes], free_only:bool} para um idMember (com cache)."""
    if idm in cache and "free_only" in cache[idm]:
        return cache[idm]
    reg = _buscar_membro(evo, idm)
    ativos = contratos_ativos(reg) if reg else []
    frees = free_ativos(reg, regras) if reg else []
    info = {
        "achou": bool(reg),
        "ativos": ativos,
        # free_only = TEM contrato ativo e TODOS são FREE (aí é "FREE flutuante", fora)
        "free_only": bool(ativos) and len(frees) == len(ativos),
        "ts": time.time(),
    }
    cache[idm] = info
    return info


def montar_grade(evo=None, dias=7, branch_id=None, now=None):
    """Monta a grade de matrículas fixas dos próximos `dias` dias (padrão 7).

    Retorna dict: {gerado_em, inicio, fim, dias:[...], turmas:[...], resumo:{...}}.
    Cada turma: {data, weekday, hora, activity, professora, idConfiguration,
    capacity, nFixas, vagas, fixas:[nomes]}.
    """
    evo = evo or EvoClient()
    now = now or agora_brasilia()
    inicio = now.date()
    fim = inicio + timedelta(days=max(1, int(dias)) - 1)
    activity = config.EVO_ACTIVITY or None
    id_activity = config.EVO_ACTIVITY_ID or None
    regras = carregar_regras()
    cache = _carregar_cache()

    turmas = []
    seen = set()
    total_fixas = excl_free = excl_repos = excl_exp = excl_removed = 0

    d = inicio
    while d <= fim:
        ds = d.strftime("%Y-%m-%d")
        try:
            sched = evo.list_schedule(ds, show_full_week=True, branch_id=branch_id) or []
        except Exception as e:
            log.warning("grade: falha ao ler a grade de %s (%s)", ds, e)
            d += timedelta(days=1)
            continue
        for s in sched:
            dt = session_start_datetime(s)
            if not dt or dt.date() != d:
                continue
            if not _match_activity(s, activity, id_activity):
                continue
            idc = s.get("idConfiguration")
            key = (idc, ds)
            if not idc or key in seen:
                continue
            seen.add(key)
            try:
                det = evo.schedule_detail(id_configuration=idc, activity_date=ds,
                                          branch_id=branch_id) or {}
            except Exception:
                det = {}
            fixas = []
            for en in (det.get("enrollments") or []):
                if en.get("idProspect") or not en.get("idMember"):
                    excl_exp += 1
                    continue                 # experimental (lead)
                if en.get("replacement"):
                    excl_repos += 1
                    continue                 # reposição — não é fixa deste horário
                if en.get("removed"):
                    excl_removed += 1
                    continue                 # tirada da turma
                idm = en.get("idMember")
                info = _plano_membro(evo, idm, regras, cache)
                if info.get("achou") and info.get("ativos") and info.get("free_only"):
                    excl_free += 1
                    continue                 # plano só FREE → flutuante, fora
                fixas.append(en.get("name") or f"id={idm}")
            fixas.sort(key=_norm)
            cap = s.get("capacity")
            nf = len(fixas)
            total_fixas += nf
            turmas.append({
                "data": ds, "weekday": dt.weekday(), "hora": dt.strftime("%H:%M"),
                "activity": s.get("name") or activity or "", "professora": _prof(s),
                "idConfiguration": idc, "capacity": cap, "nFixas": nf,
                "vagas": (max(cap - nf, 0) if cap is not None else None),
                "fixas": fixas,
            })
        d += timedelta(days=1)

    _salvar_cache(cache)
    turmas.sort(key=lambda t: (t["data"], t["hora"]))
    return {
        "gerado_em": now.strftime("%Y-%m-%d %H:%M"),
        "inicio": inicio.strftime("%Y-%m-%d"),
        "fim": fim.strftime("%Y-%m-%d"),
        "dias": [(inicio + timedelta(days=i)).strftime("%Y-%m-%d")
                 for i in range((fim - inicio).days + 1)],
        "turmas": turmas,
        "resumo": {
            "fixas": total_fixas, "excluidas_free": excl_free,
            "excluidas_reposicao": excl_repos, "excluidas_experimental": excl_exp,
            "excluidas_removidas": excl_removed, "turmas": len(turmas),
        },
    }
