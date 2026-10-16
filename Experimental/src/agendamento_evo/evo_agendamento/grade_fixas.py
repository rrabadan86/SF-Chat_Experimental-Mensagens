# -*- coding: utf-8 -*-
"""
Grade de MATRÍCULAS FIXAS por turma (previsibilidade de vaga pra matrícula).

Como separamos FIXA de REPOSIÇÃO/FREE (o EVO não marca isso no enrollment da
turma): lendo a turma numa SEMANA FUTURA. A matrícula fixa é recorrente (o EVO já
deixa pré-criada nas próximas semanas), enquanto REPOSIÇÃO e marcação FREE são
sempre pontuais (ninguém repõe/marca FREE com semanas de antecedência). Então o
roster de uma ocorrência ~2 semanas à frente (mesmo idConfiguration) é exatamente
a lista de alunas FIXAS — bate com o ícone "R" (reposição) da tela do EVO.

Validado: SLIMFIT B Sex 07:00 (idConfig 1170) na semana atual tinha 11 (com 2
reposições + 1 FREE); 23/10, 30/10 e 06/11 deram 8 idênticas (as fixas).

Sempre de fora: experimentais (idProspect) e removidas (removed). A FALTA não
exclui: a matrícula fixa continua na turma toda semana.
"""
from datetime import timedelta
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


def montar_grade(evo=None, dias=7, semanas_frente=2, branch_id=None, now=None):
    """Grade de matrículas fixas dos próximos `dias` dias. O roster FIXO de cada
    turma é lido `semanas_frente` semanas à frente (onde não há reposição/FREE)."""
    evo = evo or EvoClient()
    now = now or agora_brasilia()
    inicio = now.date()
    fim = inicio + timedelta(days=max(1, int(dias)) - 1)
    activity = config.EVO_ACTIVITY or None
    id_activity = config.EVO_ACTIVITY_ID or None

    # offsets (em semanas) para ler o FIXO: a 1ª que vier NÃO-vazia vale.
    # +0 (semana atual, inclui reposição/FREE) só como último recurso.
    base = max(1, int(semanas_frente))
    offsets = []
    for o in (base, base + 1, 1, 0):
        if o not in offsets:
            offsets.append(o)

    # cache: grade por semana (lista) e detail por (idConfig, data).
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

    det_cache = {}
    def _roster(idc, dstr):
        """{idMember: nome} das matrículas da turma nessa data, ou None se erro."""
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

    turmas = []
    seen = set()
    total_fixas = 0
    d = inicio
    while d <= fim:
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
            # lê o FIXO numa semana futura (idConfig é o mesmo toda semana).
            roster, usou = None, None
            for off in offsets:
                fut = (d + timedelta(days=7 * off)).strftime("%Y-%m-%d")
                r = _roster(idc, fut)
                if r is None:          # erro de leitura → tenta o próximo offset
                    continue
                if r or off == 0:      # não-vazio (ou +0 = último recurso)
                    roster, usou = r, off
                    break
            fixas = sorted((roster or {}).values(), key=_norm)
            cap = s.get("capacity")
            nf = len(fixas)
            total_fixas += nf
            turmas.append({
                "data": d.strftime("%Y-%m-%d"), "weekday": dt.weekday(), "hora": dt.strftime("%H:%M"),
                "activity": s.get("name") or activity or "", "professora": _prof(s),
                "idConfiguration": idc, "capacity": cap, "nFixas": nf,
                "vagas": (max(cap - nf, 0) if cap is not None else None),
                "fonte_semanas": usou, "fixas": fixas,
            })
        d += timedelta(days=1)

    turmas.sort(key=lambda t: (t["data"], t["hora"]))
    return {
        "gerado_em": now.strftime("%Y-%m-%d %H:%M"),
        "inicio": inicio.strftime("%Y-%m-%d"),
        "fim": fim.strftime("%Y-%m-%d"),
        "semanas_frente": base,
        "dias": [(inicio + timedelta(days=i)).strftime("%Y-%m-%d")
                 for i in range((fim - inicio).days + 1)],
        "turmas": turmas,
        "resumo": {"fixas": total_fixas, "turmas": len(turmas)},
    }
