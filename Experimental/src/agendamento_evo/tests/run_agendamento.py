#!/usr/bin/env python3
"""Agendamento de aula experimental no EVO.

Modos:
  book       Agenda direto a partir dos dados informados (nome, e-mail, telefone,
             horário). É o modo pronto pra uso — não depende do ZEE.
  slots      Lista horários que aceitam aula experimental (descoberta).
  services   Lista os serviços marcados como "aula experimental" no EVO.
  from-zee   Puxa os dados de um contato do ZEE e agenda no EVO.
             (Depende de ZEE_TOKEN e de a IA salvar e-mail/horário no metadata.)

Exemplos:
  python run_agendamento.py services
  python run_agendamento.py slots --date 2026-07-10
  python run_agendamento.py book --name "Maria Silva" --email maria@x.com \\
      --phone 62999998888 --when "2026-07-10 19:00" \\
      --activity "Pilates" --service "Aula Experimental"
  python run_agendamento.py from-zee --contact-id <uuid> --when "2026-07-10 19:00"
"""
import argparse
import json
import logging
import sys

from evo_agendamento import (
    EvoClient, TurmaLotadaError, ZeeClient, book_experimental, config, process_pending,
)
from evo_agendamento.orchestrator import booking_data_from_contact, notify_studio_full


def _setup_log(verbose):
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="[%(asctime)s] %(name)s %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def cmd_services(args):
    evo = EvoClient()
    servicos = evo.list_services(experimental_only=not args.all)
    for s in servicos:
        print(f"  idService={s.get('idService')}  {s.get('nameService')!r}  "
              f"experimentalClass={s.get('experimentalClass')}  valor={s.get('value')}")
    if not servicos:
        print("Nenhum serviço encontrado (tente --all).")


def cmd_slots(args):
    from evo_agendamento.util import session_free_general, session_start_datetime

    evo = EvoClient()
    slots = evo.list_schedule(args.date, show_full_week=not args.day_only,
                              only_availables=args.free_only, branch_id=args.branch)
    shown = 0
    for a in slots:
        if args.activity and args.activity.lower() not in (a.get("name") or "").lower():
            continue
        start = session_start_datetime(a)
        quando = start.strftime("%Y-%m-%d %H:%M") if start else a.get("activityDate")
        free = session_free_general(a)
        print(f"  {quando}  {a.get('name')!r}  idConfiguration={a.get('idConfiguration')}  "
              f"ocupação={a.get('ocupation')}/{a.get('capacity')}  vagas={free}")
        shown += 1
    if not shown:
        print(f"Nenhuma turma encontrada em {args.date} (semana). "
              f"Tente outra data ou remova --free-only/--activity.")


def cmd_book(args):
    try:
        result = book_experimental(
            name=args.name, when=args.when, email=args.email, phone=args.phone,
            activity=args.activity, service=args.service,
            id_activity=args.id_activity, id_service=args.id_service,
            branch_id=args.branch,
        )
    except TurmaLotadaError as e:
        _finish_full(e, name=args.name, phone=args.phone, studio_phone=args.studio_phone)
        return
    _print_result(result)


def _finish_full(err: TurmaLotadaError, name, phone, studio_phone=None):
    """Turma lotada: avisa o WhatsApp do Studio (recepção resolve manual) e reporta."""
    studio_phone = studio_phone or config.ZEE_STUDIO_PHONE
    notified = False
    note = None
    if studio_phone and config.ZEE_TOKEN:
        try:
            zee = ZeeClient()
            notified = notify_studio_full(
                zee, name=name, phone=phone, when=err.when,
                alternatives=err.alternatives, studio_phone=studio_phone,
            )
        except Exception as ex:  # não deixa o aviso derrubar o processo
            note = f"falha ao avisar o Studio: {ex}"
            logging.getLogger("zee").warning(note)
    elif studio_phone and not config.ZEE_TOKEN:
        note = "ZEE_STUDIO_PHONE definido, mas ZEE_TOKEN ausente: aviso não enviado."
    else:
        note = "ZEE_STUDIO_PHONE não configurado: aviso não enviado."

    payload = {
        "status": "turma_lotada",
        "when": err.when,
        "aluna": {"name": name, "phone": phone},
        "studioNotified": notified,
        "studioPhone": studio_phone or None,
        "note": note,
        "message": str(err),
        "alternatives": err.alternatives,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    sys.exit(3)


def cmd_from_zee(args):
    zee = ZeeClient()
    contact = zee.get_contact(contact_id=args.contact_id, phone=args.phone)
    summary = None
    try:
        summary = zee.get_summary(args.contact_id) if args.contact_id else None
    except Exception as e:  # resumo é só fallback pra achar e-mail
        logging.getLogger("zee").warning("Sem resumo: %s", e)

    data = booking_data_from_contact(contact, summary)
    # CLI pode sobrescrever o que veio do ZEE:
    name = args.name or data["name"]
    email = args.email or data["email"]
    phone = args.phone or data["phone"]
    when = args.when or data["when"]

    faltando = [k for k, v in {"name": name, "when": when}.items() if not v]
    if faltando:
        print(f"Faltam dados obrigatórios do ZEE: {', '.join(faltando)}. "
              f"Informe via --{'/ --'.join(faltando)} ou configure o metadata no ZEE.",
              file=sys.stderr)
        sys.exit(2)

    try:
        result = book_experimental(
            name=name, when=when, email=email, phone=phone,
            activity=args.activity, service=args.service,
            id_activity=args.id_activity, id_service=args.id_service, branch_id=args.branch,
        )
    except TurmaLotadaError as e:
        _finish_full(e, name=name, phone=phone, studio_phone=args.studio_phone)
        return
    if args.done_tag:
        try:
            zee.set_contact_tag(contact.get("id") or args.contact_id, args.done_tag)
        except Exception as e:
            logging.getLogger("zee").warning("Não consegui aplicar a tag de concluído: %s", e)
    _print_result(result)


def cmd_run(args):
    """Job automático: varre o ZEE e agenda quem tem a tag 'Agendou AE'."""
    results = process_pending(hours_back=args.hours_back, dry_run=args.dry_run,
                              studio_phone=args.studio_phone)
    print(json.dumps(results, ensure_ascii=False, indent=2))


def _print_result(result):
    print("\n=== Aula experimental agendada ===")
    print(json.dumps(result.__dict__, ensure_ascii=False, indent=2))


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    ps = sub.add_parser("services", help="lista serviços de aula experimental")
    ps.add_argument("--all", action="store_true", help="lista todos os serviços, não só experimentais")
    ps.set_defaults(func=cmd_services)

    pl = sub.add_parser("slots", help="lista turmas/horários (com vaga e idConfiguration)")
    pl.add_argument("--date", required=True, help="data base (yyyy-MM-dd)")
    pl.add_argument("--day-only", action="store_true", help="só o dia (padrão: semana toda)")
    pl.add_argument("--free-only", action="store_true", help="só turmas com vaga")
    pl.add_argument("--activity", help="filtra pelo nome da atividade (ex.: SLIMFIT)")
    pl.add_argument("--branch", type=int, help="idBranch (multi-filial)")
    pl.set_defaults(func=cmd_slots)

    def add_booking_args(sp):
        sp.add_argument("--name", help="nome completo da aluna")
        sp.add_argument("--email")
        sp.add_argument("--phone")
        sp.add_argument("--when", help="horário escolhido (ex.: '2026-07-10 19:00')")
        sp.add_argument("--activity", help="nome da atividade (ou use EVO_ACTIVITY)")
        sp.add_argument("--service", help="nome do serviço da aula experimental (ou EVO_SERVICE)")
        sp.add_argument("--id-activity", type=int)
        sp.add_argument("--id-service", type=int)
        sp.add_argument("--branch", type=int, help="idBranch (multi-filial)")
        sp.add_argument("--studio-phone", help="WhatsApp do Studio p/ avisar quando lotar "
                                               "(ou use ZEE_STUDIO_PHONE)")

    pb = sub.add_parser("book", help="agenda a partir dos dados informados")
    add_booking_args(pb)
    pb.set_defaults(func=cmd_book)

    pz = sub.add_parser("from-zee", help="puxa dados de UM contato do ZEE e agenda")
    add_booking_args(pz)
    pz.add_argument("--contact-id", help="contactId no ZEE")
    pz.add_argument("--done-tag", help="tag a aplicar no ZEE após agendar")
    pz.set_defaults(func=cmd_from_zee)

    pr = sub.add_parser("run", help="job automático: varre o ZEE e agenda quem tem a tag 'Agendou AE'")
    pr.add_argument("--hours-back", type=float, default=2, help="janela de conversas a varrer (horas)")
    pr.add_argument("--studio-phone", help="WhatsApp do Studio p/ avisar quando lotar")
    pr.add_argument("--dry-run", action="store_true", help="só mostra o que faria, sem agendar")
    pr.set_defaults(func=cmd_run)

    return p


def main():
    parser = build_parser()
    args = parser.parse_args()
    _setup_log(args.verbose)
    try:
        args.func(args)
    except Exception as e:
        logging.getLogger("main").error("Falhou: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
