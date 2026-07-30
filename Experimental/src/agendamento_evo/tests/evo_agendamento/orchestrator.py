# Orquestração: dados da aluna -> cadastro + venda + matrícula (agendamento) no EVO.
#
# Espelha o processo manual do Studio:
#   1) cadastra a oportunidade (prospect)      -> POST /prospects
#   2) vende o serviço "Aula Experimental"     -> POST /sales
#   3) agenda normal (matricula na turma)      -> POST /activities/schedule/enroll
# A checagem de vaga usa a capacidade da turma (ocupation < capacity, ex.: 9),
# sem depender do flag allowExperimentalClass.
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from . import config
from .evo_client import EvoClient, EvoError
from .util import (
    fmt_datetime_evo, parse_when, same_slot, session_free_general, session_has_room_normal,
    session_start_datetime, split_name,
)

log = logging.getLogger("orquestrador")

# Trechos de mensagem do EVO que indicam turma sem vaga (fonte da verdade é o EVO).
_LOTADA_HINTS = ("lotad", "capacidad", "cheia", "esgotad", "sem vaga", "vagas", "limite")


@dataclass
class BookingResult:
    id_prospect: int
    prospect_created: bool
    id_configuration: Optional[int]
    when: str
    activity: str
    service: str
    sold: bool
    enrolled: bool


class TurmaLotadaError(RuntimeError):
    """Não foi possível agendar no horário escolhido (turma cheia ou inexistente).
    Traz horários alternativos com vaga para a recepção/IA sugerir."""

    def __init__(self, when, alternatives=None, reason="sem vaga"):
        self.when = when
        self.reason = reason
        self.alternatives = alternatives or []
        msg = f"Turma de {when}: {reason}."
        if self.alternatives:
            msg += " Horários com vaga: " + ", ".join(a["when"] for a in self.alternatives[:5])
        super().__init__(msg)


def _match_activity(sess, activity=None, id_activity=None) -> bool:
    if id_activity and sess.get("idActivity") != int(id_activity):
        return False
    if activity and activity.lower() not in (sess.get("name") or "").lower():
        return False
    return True


def _find_session(schedule, when, activity=None, id_activity=None):
    """Acha a turma cujo horário (data + HH:MM) bate com o escolhido."""
    for s in schedule:
        if same_slot(s, when) and _match_activity(s, activity, id_activity):
            return s
    return None


def list_alternatives(evo, when, activity=None, id_activity=None, branch_id=None, limit=5):
    """Turmas futuras da mesma atividade que ainda têm vaga (por capacidade)."""
    schedule = evo.list_schedule(when, show_full_week=True, branch_id=branch_id)
    out = []
    for s in schedule:
        if not session_has_room_normal(s) or not _match_activity(s, activity, id_activity):
            continue
        start = session_start_datetime(s)
        if start is None:
            continue
        out.append({
            "when": start.strftime("%Y-%m-%d %H:%M"),
            "activity": s.get("name"),
            "idConfiguration": s.get("idConfiguration"),
            "freeSpots": session_free_general(s),
            "_start": start,
        })
    out.sort(key=lambda a: a["_start"])
    for a in out:
        a.pop("_start", None)
    return out[:limit]


def notify_studio_full(zee, name, phone, when, alternatives=None,
                       studio_phone=None, template=None):
    """Avisa o WhatsApp do Studio que a aluna tentou agendar e não há vaga,
    para a recepção dar andamento manual. Retorna True se enviou."""
    studio_phone = studio_phone or config.ZEE_STUDIO_PHONE
    if not studio_phone:
        log.warning("Sem vaga, mas ZEE_STUDIO_PHONE não configurado: aviso não enviado.")
        return False
    alt_txt = ""
    if alternatives:
        opcoes = "; ".join(f"{a['when']} ({a.get('freeSpots')} vaga(s))" for a in alternatives[:5])
        alt_txt = f"\nHorários com vaga: {opcoes}"
    msg = (template or config.ZEE_FULL_MSG_TEMPLATE).format(
        name=name or "(sem nome)",
        phone=phone or "(sem telefone)",
        when=when,
        alternatives=alt_txt,
    )
    zee.notify_phone(studio_phone, msg, name=config.ZEE_STUDIO_NAME)
    log.info("Studio avisado (%s): aluna %s sem vaga em %s", studio_phone, name, when)
    return True


def book_experimental(
    name: str,
    when,                       # datetime ou string (horário escolhido)
    email: str = None,
    phone: str = None,
    activity: str = None,       # nome da atividade (default: EVO_ACTIVITY)
    service: str = None,        # nome do serviço da aula experimental (default: EVO_SERVICE)
    id_activity=None,           # ou por id (default: EVO_ACTIVITY_ID)
    id_service=None,            # ou por id (default: EVO_SERVICE_ID)
    branch_id=None,
    check_capacity: bool = True,   # checa vaga (ocupation < capacity) e sugere alternativas
    sell_service: bool = True,     # vende o serviço "Aula Experimental" antes de matricular
    evo: EvoClient = None,
) -> BookingResult:
    """Fluxo real do Studio: cadastro -> venda do serviço -> matrícula na turma.

    Se a turma do horário estiver cheia (ou não existir turma nesse horário),
    levanta TurmaLotadaError com horários alternativos que têm vaga.
    """
    evo = evo or EvoClient()

    # "segunda às 8h15" / "amanhã 07:00" / "dia 17 às 8h" -> data real (yyyy-MM-dd HH:mm)
    when = parse_when(when)

    activity = activity or config.EVO_ACTIVITY or None
    service = service or config.EVO_SERVICE or None
    id_activity = id_activity or (config.EVO_ACTIVITY_ID or None)
    id_service = id_service or (config.EVO_SERVICE_ID or None)

    # Para vender, precisamos do id do serviço (resolve pelo nome se só veio o nome).
    if sell_service and not id_service:
        if service:
            match = next((s for s in evo.list_services(branch_id=branch_id)
                          if service.lower() in (s.get("nameService") or "").lower()), None)
            id_service = match.get("idService") if match else None
        if not id_service:
            raise ValueError("Informe o serviço da aula experimental (EVO_SERVICE_ID ou EVO_SERVICE).")

    # 1) localizar a turma do horário escolhido
    schedule = evo.list_schedule(when, show_full_week=True, branch_id=branch_id)
    session = _find_session(schedule, when, activity, id_activity)
    if session is None:
        raise TurmaLotadaError(
            fmt_datetime_evo(when),
            alternatives=list_alternatives(evo, when, activity, id_activity, branch_id),
            reason="não há turma nesse horário",
        )
    if check_capacity and not session_has_room_normal(session):
        raise TurmaLotadaError(
            fmt_datetime_evo(when),
            alternatives=list_alternatives(evo, when, activity, id_activity, branch_id),
        )

    id_configuration = session.get("idConfiguration")

    # 2) cadastro (idempotente)
    first, last = split_name(name)
    id_prospect, created = evo.get_or_create_prospect(
        name=first, last_name=last, email=email, phone=phone, branch_id=branch_id,
    )

    # 3) vende o serviço "Aula Experimental"
    sold = False
    if sell_service and id_service:
        evo.create_sale(
            id_service=id_service, id_prospect=id_prospect,
            service_value=config.EVO_SERVICE_VALUE, payment=config.EVO_PAYMENT,
            branch_id=branch_id,
        )
        sold = True

    # 4) matricula na turma (agendamento normal). O EVO é a fonte da verdade da
    # capacidade: se a última vaga sumiu, ele recusa e devolvemos alternativas.
    try:
        evo.enroll_schedule(id_configuration, activity_date=when, id_prospect=id_prospect)
    except EvoError as e:
        if check_capacity and any(h in str(e).lower() for h in _LOTADA_HINTS):
            raise TurmaLotadaError(
                fmt_datetime_evo(when),
                alternatives=list_alternatives(evo, when, activity, id_activity, branch_id),
            ) from e
        raise

    return BookingResult(
        id_prospect=id_prospect,
        prospect_created=created,
        id_configuration=id_configuration,
        when=fmt_datetime_evo(when),
        activity=session.get("name") or activity or f"id={id_activity}",
        service=service or f"id={id_service}",
        sold=sold,
        enrolled=True,
    )


def booking_data_from_contact(contact: dict, summary: str = None):
    """Extrai (nome, telefone, e-mail, horário) de um contato do ZEE.

    Fonte principal: o RESUMO do ZEE configurado para devolver um JSON com
    nome_completo / email / dia / hora (ver instrução no README). Telefone vem
    do contato. Se o resumo não vier em JSON, cai no fallback (metadata / regex)."""
    from .util import extract_email, parse_summary_json

    contact = contact or {}
    phone = contact.get("phone")

    # 1) resumo em JSON (caminho recomendado)
    s = parse_summary_json(summary)
    if s:
        name = (s.get("nome_completo") or s.get("nome") or "").strip() or None
        email = (s.get("email") or "").strip() or None
        dia = (s.get("dia") or "").strip()
        hora = (s.get("hora") or "").strip()
        when = f"{dia} {hora}".strip() or None
        return {"name": name, "phone": phone, "email": email, "when": when}

    # 2) fallback: metadata do contato / e-mail no texto
    meta = contact.get("metadata") or {}
    name = meta.get("nome") or contact.get("name") or contact.get("displayName")
    email = meta.get(config.ZEE_META_EMAIL_KEY) or extract_email(summary or "")
    when = meta.get(config.ZEE_META_WHEN_KEY)
    return {"name": name, "phone": phone, "email": email, "when": when}


# ================= Job de polling (a cada 30 min no GitHub Actions) =================
def _parse_iso(s):
    """Data ISO do ZEE (com 'Z') -> datetime naive em UTC."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "").replace("+00:00", ""))
    except (ValueError, TypeError):
        return None


def _recent_threads(zee, hours_back, now_utc):
    """Conversas relevantes: o GET /threads (sem parâmetros) já devolve as recentes.
    Mantemos as abertas (endDate nulo) e as que finalizaram/começaram na janela."""
    threads = zee.list_threads() or []
    cutoff = now_utc - timedelta(hours=hours_back)
    out = []
    for t in threads or []:
        end = (t or {}).get("endDate")
        if not end:                       # conversa em andamento
            out.append(t)
            continue
        ref = _parse_iso(end) or _parse_iso((t or {}).get("startDate"))
        if ref is None or ref >= cutoff:
            out.append(t)
    return out


def _unique_contact_ids(threads):
    seen, ids = set(), []
    for t in threads or []:
        cid = (t or {}).get("contactId")
        if cid and cid not in seen:
            seen.add(cid)
            ids.append(cid)
    return ids


def _mark_done(zee, contact, cid, done_tag_id):
    if not done_tag_id:
        return
    try:
        zee.set_contact_tag(contact.get("id") or cid, done_tag_id)
    except Exception as e:
        log.warning("Não consegui marcar a tag 'feito' em %s: %s", cid, e)


def process_pending(zee=None, evo=None, hours_back=2, todo_tag=None, done_tag=None,
                    done_tag_id=None, studio_phone=None, dry_run=False, now=None):
    """Loop do job automático: acha contatos com a tag 'Agendou AE' nas conversas
    recentes, agenda no EVO e marca a tag 'Feito'. Idempotente (pula quem já tem 'Feito').

    Filtro por NOME da tag (o GET /contact devolve nomes); a marcação usa o ID."""
    from .zee_client import ZeeClient

    zee = zee or ZeeClient()
    evo = evo or EvoClient()
    todo_tag = todo_tag or config.ZEE_TAG_TODO           # nome
    done_tag = done_tag or config.ZEE_TAG_DONE           # nome
    done_tag_id = done_tag_id or config.ZEE_TAG_DONE_ID  # id
    if not todo_tag:
        raise ValueError("ZEE_TAG_TODO não configurado (tag 'Agendou AE').")

    now_utc = now or datetime.utcnow()
    threads = _recent_threads(zee, hours_back, now_utc)
    results = {"processed": [], "full": [], "skipped": [], "errors": []}

    for cid in _unique_contact_ids(threads):
        try:
            contact = zee.get_contact(contact_id=cid) or {}
        except Exception as e:
            results["errors"].append({"contactId": cid, "error": str(e)})
            continue

        tags = contact.get("tags") or []
        if todo_tag not in tags:
            continue                                   # não fechou aula experimental
        if done_tag and done_tag in tags:
            continue                                   # já processado

        summary = None
        try:
            summary = zee.get_summary(cid)
        except Exception:
            pass
        data = booking_data_from_contact(contact, summary)
        name, phone, email, when = data["name"], data["phone"], data["email"], data["when"]

        if not name or not when:
            results["skipped"].append({"contactId": cid, "motivo": "faltam nome/horário", **data})
            continue

        if dry_run:
            results["processed"].append({"contactId": cid, "dryRun": True, **data})
            continue

        try:
            res = book_experimental(name=name, when=when, email=email, phone=phone, evo=evo)
            _mark_done(zee, contact, cid, done_tag_id)
            results["processed"].append({
                "contactId": cid, "idProspect": res.id_prospect, "when": res.when,
                "idConfiguration": res.id_configuration,
            })
        except TurmaLotadaError as e:
            notify_studio_full(zee, name=name, phone=phone, when=e.when,
                               alternatives=e.alternatives, studio_phone=studio_phone)
            _mark_done(zee, contact, cid, done_tag_id)  # evita re-avisar o Studio a cada ciclo
            results["full"].append({"contactId": cid, "when": e.when, "alternatives": e.alternatives})
        except Exception as e:
            results["errors"].append({"contactId": cid, "name": name, "error": str(e)})

    log.info("Processados=%d, lotados=%d, pulados=%d, erros=%d",
             len(results["processed"]), len(results["full"]),
             len(results["skipped"]), len(results["errors"]))
    return results
