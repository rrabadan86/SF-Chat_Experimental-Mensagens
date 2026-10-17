# -*- coding: utf-8 -*-
"""
Grade da SEMANA por turma: vaga de MATRÍCULA (fixas) + ocupação REAL (fixas +
reposição + FREE) + PRESENÇA das fixas (quem foi / quem faltou).

Quem é FIXA: a API do EVO expõe as matrículas FIXAS (recorrentes) de cada aluna em
/api/v1/activities/enrollment/member-enrollment — a lista de turmas (idConfiguration)
do CONTRATO dela. Numa turma X é FIXA quem tem o idConfiguration de X na própria lista
(ativa). Quem está na turma mas NÃO tem X:
  - se tem turma fixa em OUTRO horário  → REPOSIÇÃO (aluna fixa repondo aqui);
  - se não tem NENHUMA turma fixa       → FREE (plano flexível, marca avulso).

Presença (só para aulas que JÁ aconteceram): o enrollment traz `status`
(0=presente, 1=falta, 2=falta justificada). Para aulas futuras o status ainda não
vale como presença, então só mostramos "foi/faltou" nas ocorrências passadas.

A grade é de uma SEMANA (semana_offset: 0 = semana atual, -1 = anterior, +1 = próxima).
Custo por semana: 1 schedule/detail por turma; o member-enrollment (mais pesado) é
1 por aluna e fica em cache (a estrutura fixa é a mesma toda semana).
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


def _presenca(info):
    """'foi' | 'faltou' | 'justif' | '?' a partir do status do roster (dict com as
    chaves 'status' e 'justif')."""
    if info.get("justif") or info.get("status") == 2:
        return "justif"
    if info.get("status") == 1:
        return "faltou"
    if info.get("status") == 0:
        return "foi"
    return "?"


def montar_grade(evo=None, semana_offset=0, branch_id=None, now=None, **_ignored):
    """Grade da semana (semana_offset: 0 = atual). Cada turma traz a vaga de matrícula
    (fixas), a ocupação real (fixas + reposição + FREE) e a presença das fixas nas
    aulas que já aconteceram."""
    evo = evo or EvoClient()
    now = now or agora_brasilia()
    hoje = now.date()
    try:
        off = int(semana_offset)
    except Exception:
        off = 0
    monday = hoje - timedelta(days=hoje.weekday()) + timedelta(days=7 * off)
    dias_semana = [monday + timedelta(days=i) for i in range(7)]   # Seg..Dom
    inicio, fim = monday, monday + timedelta(days=5)               # exibe Seg..Sáb
    activity = config.EVO_ACTIVITY or None
    id_activity = config.EVO_ACTIVITY_ID or None

    # cache: grade da semana (list_schedule) e detail por (idConfig, data).
    week_cache = {}
    def _week_sched(dt):
        wk = dt - timedelta(days=dt.weekday())
        if wk not in week_cache:
            try:
                week_cache[wk] = evo.list_schedule(wk.strftime("%Y-%m-%d"),
                                                   show_full_week=True, branch_id=branch_id) or []
            except Exception as e:
                log.warning("grade: falha ao listar a semana de %s (%s)", wk, e)
                week_cache[wk] = []
        return week_cache[wk]

    # roster da turma num dia: {idMember: {"nome","status","justif"}} (exclui
    # experimental/removida).
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
                    r[x["idMember"]] = {
                        "nome": (x.get("name") or f"id={x['idMember']}").strip(),
                        "status": x.get("status"), "justif": bool(x.get("justifiedAbsence")),
                    }
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
                                  if e.get("idConfiguration") and _matricula_ativa(e, hoje)}
            except Exception:
                fix_cache[idm] = None     # erro de leitura → desconhecido
        return fix_cache[idm]

    turmas = []
    seen = set()
    total_fixas = 0
    alunas_fixas_ids = set()
    for d in dias_semana:
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
            aconteceu = dt <= now
            roster = _roster(idc, dstr) or {}
            fixas, reposicao, free = [], [], []
            incerto = 0
            for idm, info in roster.items():
                fs = _fixset(idm)
                nome = info["nome"]
                if fs is None:
                    incerto += 1
                elif idc in fs:                         # FIXA desta turma
                    fixas.append({"nome": nome, "pres": _presenca(info) if aconteceu else None})
                    alunas_fixas_ids.add(idm)
                elif fs:                                # fixa em OUTRA turma → reposição
                    reposicao.append(nome)
                else:                                   # sem turma fixa → FREE
                    free.append(nome)
            fixas.sort(key=lambda x: _norm(x["nome"]))
            reposicao.sort(key=_norm)
            free.sort(key=_norm)
            cap = s.get("capacity")
            nf = len(fixas)
            n_real = nf + len(reposicao) + len(free)
            total_fixas += nf
            presentes = sum(1 for x in fixas if x["pres"] == "foi") if aconteceu else None
            faltas = sum(1 for x in fixas if x["pres"] in ("faltou", "justif")) if aconteceu else None
            turmas.append({
                "data": dstr, "weekday": dt.weekday(), "hora": dt.strftime("%H:%M"),
                "activity": s.get("name") or activity or "", "professora": _prof(s),
                "idConfiguration": idc, "capacity": cap,
                "nFixas": nf, "vagas": (max(cap - nf, 0) if cap is not None else None),
                "nRepo": len(reposicao), "nFree": len(free), "nReal": n_real,
                "aconteceu": aconteceu, "presentes": presentes, "faltas": faltas,
                "incerto": incerto,
                "fixas": fixas, "reposicao": reposicao, "free": free,
            })

    turmas.sort(key=lambda t: (t["data"], t["hora"]))

    # Métricas agregadas — por FIXAS, excluindo o SÁBADO (escala) da ocupação.
    total_vagas = sum(t["capacity"] for t in turmas if t["capacity"])
    uteis = [t for t in turmas if t["weekday"] != 5]
    oc_fixas = sum(t["nFixas"] for t in uteis)
    oc_vagas = sum(t["capacity"] for t in uteis if t["capacity"])
    ocupacao_pct = round(oc_fixas / oc_vagas * 100) if oc_vagas else None
    prof_agg = {}
    for t in uteis:
        p = t["professora"] or "—"
        a = prof_agg.setdefault(p, {"fixas": 0, "vagas": 0, "turmas": 0})
        a["fixas"] += t["nFixas"]
        if t["capacity"]:
            a["vagas"] += t["capacity"]
        a["turmas"] += 1
    por_professora = sorted(
        ({"professora": p, "fixas": a["fixas"], "vagas": a["vagas"], "turmas": a["turmas"],
          "pct": (round(a["fixas"] / a["vagas"] * 100) if a["vagas"] else None)}
         for p, a in prof_agg.items()),
        key=lambda x: (x["pct"] is None, -(x["pct"] or 0), x["professora"]))

    return {
        "gerado_em": now.strftime("%Y-%m-%d %H:%M"),
        "semana_offset": off,
        "inicio": inicio.strftime("%Y-%m-%d"),
        "fim": fim.strftime("%Y-%m-%d"),
        "metodo": "member-enrollment",
        "dias": [d.strftime("%Y-%m-%d") for d in dias_semana[:6]],   # Seg..Sáb
        "turmas": turmas,
        "por_professora": por_professora,
        "resumo": {
            "fixas": total_fixas,
            "alunas_fixas": len(alunas_fixas_ids),
            "turmas": len(turmas),
            "total_vagas": total_vagas,
            "ocupacao_pct": ocupacao_pct,
            "ocupacao_fixas": oc_fixas,
            "ocupacao_vagas": oc_vagas,
        },
    }
