# -*- coding: utf-8 -*-
"""
Grade de MATRÍCULAS FIXAS por turma (previsibilidade de vaga pra matrícula).

Como sabemos quem é FIXA (e não reposição/FREE): a API do EVO expõe as matrículas
FIXAS (recorrentes) de cada aluna em /api/v1/activities/enrollment/member-enrollment
— é a lista de turmas (idConfiguration) do CONTRATO dela. Então, para uma turma X:
é FIXA quem tem o idConfiguration de X na própria lista de matrículas (status ativo,
sem endDate vencido). Quem está na turma mas NÃO tem X nessa lista é reposição ou
marcação FREE — e fica de fora.

Isso é EXATO (bate com os ícones "R"/"RC" da tela do EVO), não depende de heurística
nem de ler semanas futuras, e inclui a fixa mesmo que ela vá FALTAR naquele dia.
Validado: na turma de sáb 08:30 (idConfig 1225), Andreia (3646) tem 1225 na lista
(fixa) e Márcia (7615) só tem 1169/1170 (logo, reposição no 1225).

O roster de cada turma (schedule/detail) dá os membros daquele dia; o member-
enrollment (1 chamada por aluna, em cache) diz em quais turmas ela é fixa.
Sempre de fora: experimentais (idProspect) e removidas (removed).
"""
from datetime import datetime, timedelta
import logging

from . import config
from .evo_client import EvoClient
from .util import agora_brasilia, session_start_datetime
from .orchestrator import _match_activity
from .free_antecedencia import _norm

log = logging.getLogger(__name__)


def _prof(s):
    """Professora da turma. O /activities/schedule já traz `instructor` (string)."""
    v = s.get("instructor")
    if isinstance(v, str) and v.strip():
        return v.strip()
    if isinstance(v, dict):
        nome = str(v.get("name") or v.get("firstName") or "").strip()
        if nome:
            return nome
    for k in ("instructorName", "employeeName", "teacherName", "professor", "professorName"):
        vv = s.get(k)
        if isinstance(vv, str) and vv.strip():
            return vv.strip()
    return ""


def _matricula_ativa(e, hoje):
    """True se a matrícula fixa `e` (item do member-enrollment) está vigente HOJE:
    status ativo (1) e sem endDate (ou endDate ainda no futuro)."""
    if e.get("status") not in (1, None):      # 1 = matrícula ativa
        return False
    end = e.get("endDate")
    if not end:
        return True
    try:
        return datetime.fromisoformat(str(end)[:19]).date() >= hoje
    except Exception:
        return True


def montar_grade(evo=None, dias=7, branch_id=None, now=None, **_ignored):
    """Grade de matrículas fixas dos próximos `dias` dias. FIXA de uma turma = a aluna
    tem o idConfiguration daquela turma na própria lista de matrículas fixas
    (member-enrollment). Reposição/FREE não têm → ficam de fora."""
    evo = evo or EvoClient()
    now = now or agora_brasilia()
    inicio = now.date()
    fim = inicio + timedelta(days=max(1, int(dias)) - 1)
    activity = config.EVO_ACTIVITY or None
    id_activity = config.EVO_ACTIVITY_ID or None

    # cache da grade por semana (list_schedule).
    week_cache = {}
    def _week_sched(dt):
        wk = dt - timedelta(days=dt.weekday())   # segunda-feira daquela semana
        if wk not in week_cache:
            try:
                week_cache[wk] = evo.list_schedule(wk.strftime("%Y-%m-%d"),
                                                   show_full_week=True, branch_id=branch_id) or []
            except Exception as e:
                log.warning("grade: falha ao listar a semana de %s (%s)", wk, e)
                week_cache[wk] = []
        return week_cache[wk]

    # roster da turma num dia: {idMember: nome} (exclui experimental/removida).
    det_cache = {}
    def _roster(idc, dstr):
        key = (idc, dstr)
        if key not in det_cache:
            try:
                enr = (evo.schedule_detail(id_configuration=idc, activity_date=dstr,
                                           branch_id=branch_id) or {}).get("enrollments") or []
                r = {}
                for x in enr:
                    if not x.get("idMember") or x.get("idProspect") or x.get("removed"):
                        continue
                    r[x["idMember"]] = (x.get("name") or f"id={x['idMember']}").strip()
                det_cache[key] = r
            except Exception:
                det_cache[key] = None
        return det_cache[key]

    # matrículas FIXAS (idConfiguration) de cada aluna — 1 chamada por aluna, em cache.
    fix_cache = {}
    def _fixset(idm):
        if idm not in fix_cache:
            try:
                data = evo.member_enrollments(idm, branch_id=branch_id) or []
                fix_cache[idm] = {e["idConfiguration"] for e in data
                                  if e.get("idConfiguration") and _matricula_ativa(e, inicio)}
            except Exception:
                fix_cache[idm] = None     # erro de leitura → desconhecido (não conta)
        return fix_cache[idm]

    turmas = []
    seen = set()
    total_fixas = 0
    d = inicio
    while d <= fim:
        dstr = d.strftime("%Y-%m-%d")
        for s in _week_sched(d):
            dt = session_start_datetime(s)
            if not dt or dt.date() != d:
                continue
            if not _match_activity(s, activity, id_activity):
                continue
            idc = s.get("idConfiguration")
            if not idc or (idc, d) in seen:
                continue
            seen.add((idc, d))
            roster = _roster(idc, dstr) or {}
            # FIXA = aluna cujo contrato inclui ESTA turma (idc na lista dela).
            fixas, incerto = [], 0
            for idm, nome in roster.items():
                fs = _fixset(idm)
                if fs is None:
                    incerto += 1          # não deu p/ checar (erro) → não conta como fixa
                elif idc in fs:
                    fixas.append(nome)
            fixas = sorted(fixas, key=_norm)
            cap = s.get("capacity")
            nf = len(fixas)
            total_fixas += nf
            turmas.append({
                "data": dstr, "weekday": dt.weekday(), "hora": dt.strftime("%H:%M"),
                "activity": s.get("name") or activity or "", "professora": _prof(s),
                "idConfiguration": idc, "capacity": cap, "nFixas": nf,
                "vagas": (max(cap - nf, 0) if cap is not None else None),
                "incerto": incerto, "fixas": fixas,
            })
        d += timedelta(days=1)

    turmas.sort(key=lambda t: (t["data"], t["hora"]))
    return {
        "gerado_em": now.strftime("%Y-%m-%d %H:%M"),
        "inicio": inicio.strftime("%Y-%m-%d"),
        "fim": fim.strftime("%Y-%m-%d"),
        "metodo": "member-enrollment",
        "dias": [(inicio + timedelta(days=i)).strftime("%Y-%m-%d")
                 for i in range((fim - inicio).days + 1)],
        "turmas": turmas,
        "resumo": {"fixas": total_fixas, "turmas": len(turmas)},
    }
