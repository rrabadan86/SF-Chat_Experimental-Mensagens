# -*- coding: utf-8 -*-
"""
Grade de MATRÍCULAS FIXAS por turma (previsibilidade de vaga pra matrícula).

O EVO NÃO marca reposição/FREE no enrollment da turma: o campo `replacement` vem
sempre false, `slotNumber` só reflete presença, e o cadastro da aluna não traz a
agenda fixa. Então separamos FIXA de REPOSIÇÃO/FREE por RECORRÊNCIA entre semanas:

  A matrícula FIXA é RECORRENTE — a aluna aparece naquela turma (mesmo
  idConfiguration, mesmo dia da semana) TODA semana, inclusive faltando (a
  matrícula continua na lista com status de ausência). Já a REPOSIÇÃO (quem veio
  repor aula de outro horário) e a marcação FREE aparecem só na semana pontual.

Para cada turma, olhamos as próximas `semanas` ocorrências (mesmo idConfiguration,
+7/+14 dias) e contamos em quantas a aluna tem matrícula. Entra como FIXA quem
aparece em pelo menos `min_semanas` delas. Reposição/FREE (1 semana só) ficam de
fora — e assim a turma nunca passa da capacidade.

Sempre de fora: experimentais (idProspect) e removidas (removed). A FALTA NÃO
exclui: a matrícula fixa continua listada toda semana.
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


def montar_grade(evo=None, dias=7, semanas=3, min_semanas=2, branch_id=None, now=None):
    """Grade de matrículas fixas dos próximos `dias` dias, separando fixa de
    reposição/FREE por recorrência (`semanas` ocorrências, mínimo `min_semanas`).

    Retorna dict: {gerado_em, inicio, fim, semanas, min_semanas, dias, turmas, resumo}.
    Cada turma: {data, weekday, hora, activity, professora, idConfiguration,
    capacity, nFixas, vagas, visitantes, fixas:[nomes]}.
    """
    evo = evo or EvoClient()
    now = now or agora_brasilia()
    inicio = now.date()
    fim = inicio + timedelta(days=max(1, int(dias)) - 1)
    activity = config.EVO_ACTIVITY or None
    id_activity = config.EVO_ACTIVITY_ID or None
    semanas = max(1, int(semanas))
    min_semanas = max(1, min(int(min_semanas), semanas))

    # 1) turmas da janela (estrutura a exibir): idConfiguration + dia/hora.
    base = []
    seen = set()
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
            if not idc or (idc, ds) in seen:
                continue
            seen.add((idc, ds))
            base.append({"idc": idc, "date": d, "weekday": dt.weekday(),
                         "hora": dt.strftime("%H:%M"),
                         "activity": s.get("name") or activity or "",
                         "prof": _prof(s), "capacity": s.get("capacity")})
        d += timedelta(days=1)

    # 2) recorrência: schedule_detail de cada turma nas próximas `semanas` semanas.
    det_cache = {}

    def _enr(idc, dstr):
        key = (idc, dstr)
        if key not in det_cache:
            try:
                det_cache[key] = (evo.schedule_detail(id_configuration=idc, activity_date=dstr,
                                                      branch_id=branch_id) or {}).get("enrollments") or []
            except Exception:
                det_cache[key] = []
        return det_cache[key]

    turmas = []
    total_fixas = total_visitantes = 0
    for bt in base:
        cont = {}   # idMember -> {"n": nº de semanas em que aparece, "nome": ...}
        for w in range(semanas):
            dd = bt["date"] + timedelta(days=7 * w)
            for en in _enr(bt["idc"], dd.strftime("%Y-%m-%d")):
                if en.get("idProspect") or not en.get("idMember"):
                    continue
                if en.get("removed"):
                    continue
                idm = en.get("idMember")
                c = cont.setdefault(idm, {"n": 0, "nome": en.get("name") or f"id={idm}"})
                c["n"] += 1
        fixas = sorted((c["nome"] for c in cont.values() if c["n"] >= min_semanas), key=_norm)
        # visitantes = quem apareceu em < min_semanas (reposição/FREE da semana)
        visitantes = sum(1 for c in cont.values() if c["n"] < min_semanas)
        cap = bt["capacity"]
        nf = len(fixas)
        total_fixas += nf
        total_visitantes += visitantes
        turmas.append({
            "data": bt["date"].strftime("%Y-%m-%d"), "weekday": bt["weekday"], "hora": bt["hora"],
            "activity": bt["activity"], "professora": bt["prof"],
            "idConfiguration": bt["idc"], "capacity": cap, "nFixas": nf,
            "vagas": (max(cap - nf, 0) if cap is not None else None),
            "visitantes": visitantes, "fixas": fixas,
        })

    turmas.sort(key=lambda t: (t["data"], t["hora"]))
    return {
        "gerado_em": now.strftime("%Y-%m-%d %H:%M"),
        "inicio": inicio.strftime("%Y-%m-%d"),
        "fim": fim.strftime("%Y-%m-%d"),
        "semanas": semanas, "min_semanas": min_semanas,
        "dias": [(inicio + timedelta(days=i)).strftime("%Y-%m-%d")
                 for i in range((fim - inicio).days + 1)],
        "turmas": turmas,
        "resumo": {"fixas": total_fixas, "turmas": len(turmas), "visitantes": total_visitantes},
    }
