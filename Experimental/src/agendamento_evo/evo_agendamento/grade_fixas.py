# -*- coding: utf-8 -*-
"""
Grade de MATRÍCULAS FIXAS por turma (previsibilidade de vaga pra matrícula).

Como separamos FIXA de REPOSIÇÃO/FREE (a API pública do EVO NÃO marca isso no
enrollment — `replacement` vem sempre false, não há campo de reposição): pela
RECORRÊNCIA entre semanas. A matrícula fixa é recorrente (o EVO deixa a aluna
pré-matriculada em TODAS as próximas semanas daquela turma), enquanto REPOSIÇÃO e
marcação FREE são PONTUAIS — aparecem numa semana só. Então lemos VÁRIAS semanas
futuras da mesma turma (mesmo idConfiguration) e cruzamos: é FIXA quem aparece em
>= 2 dessas semanas; quem aparece em uma só é reposição/FREE e fica de fora.

Ler só 1 semana futura (versão anterior) marcava reposição como fixa quando a
reposição caía justo naquela semana — era o bug. Contamos só as semanas em que a
turma EXISTE na grade (roster vazio numa semana válida = turma sem fixas, não erro
de leitura) — assim uma turma usada só para reposição aparece com 0 fixas.

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


def montar_grade(evo=None, dias=7, semanas_frente=2, semanas_amostra=3,
                 branch_id=None, now=None):
    """Grade de matrículas fixas dos próximos `dias` dias. A FIXA de cada turma sai
    por RECORRÊNCIA: lemos `semanas_amostra` semanas futuras (a partir de
    `semanas_frente`) e consideramos fixa quem aparece em >= 2 delas (reposição/FREE
    aparece em uma só)."""
    evo = evo or EvoClient()
    now = now or agora_brasilia()
    inicio = now.date()
    fim = inicio + timedelta(days=max(1, int(dias)) - 1)
    activity = config.EVO_ACTIVITY or None
    id_activity = config.EVO_ACTIVITY_ID or None

    # Janela de semanas futuras para cruzar (ex.: base=2, amostra=3 → [2,3,4]).
    # Fallback (1, 0) só se a turma nem existir na janela (turma nova, EVO ainda não
    # pré-criou tão à frente) — aí usa uma ocorrência isolada, mesmo que inclua
    # reposição, para não ocultar a turma.
    base = max(1, int(semanas_frente))
    janela = [base + i for i in range(max(2, int(semanas_amostra)))]
    fallback = [o for o in (1, 0) if o not in janela]

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

    def _existe(idc, futdate):
        """True se a turma (idConfiguration) tem sessão naquela data futura
        (`futdate` é um datetime.date)."""
        for s in _week_sched(futdate):
            dt = session_start_datetime(s)
            if s.get("idConfiguration") == idc and dt and dt.date() == futdate:
                return True
        return False

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
            # FIXA por recorrência: conta em quantas semanas futuras (onde a turma
            # EXISTE) cada aluna aparece. Fixa = aparece em >= 2 semanas; reposição/
            # FREE aparece em uma só e fica de fora.
            cont, nomes, semanas_validas = {}, {}, 0
            for off in janela:
                futdt = d + timedelta(days=7 * off)
                if not _existe(idc, futdt):      # turma não roda nessa semana → ignora
                    continue
                r = _roster(idc, futdt.strftime("%Y-%m-%d"))
                if r is None:                    # erro de leitura → ignora a semana
                    continue
                semanas_validas += 1             # semana válida (mesmo roster vazio)
                for m, nome in r.items():
                    cont[m] = cont.get(m, 0) + 1
                    nomes[m] = nome
            if semanas_validas >= 2:
                ids = [m for m, c in cont.items() if c >= 2]
            else:
                # janela não deu p/ comparar (turma nova): último recurso = 1
                # ocorrência isolada (pode incluir reposição, mas não oculta a turma).
                ids, nomes = [], {}
                for off in (janela[:1] + fallback):
                    r = _roster(idc, (d + timedelta(days=7 * off)).strftime("%Y-%m-%d"))
                    if r is None:
                        continue
                    if r or off == 0:
                        ids, nomes = list(r.keys()), r
                        break
            fixas = sorted((nomes[m] for m in ids), key=_norm)
            cap = s.get("capacity")
            nf = len(fixas)
            total_fixas += nf
            turmas.append({
                "data": d.strftime("%Y-%m-%d"), "weekday": dt.weekday(), "hora": dt.strftime("%H:%M"),
                "activity": s.get("name") or activity or "", "professora": _prof(s),
                "idConfiguration": idc, "capacity": cap, "nFixas": nf,
                "vagas": (max(cap - nf, 0) if cap is not None else None),
                "fonte_semanas": semanas_validas, "fixas": fixas,
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
