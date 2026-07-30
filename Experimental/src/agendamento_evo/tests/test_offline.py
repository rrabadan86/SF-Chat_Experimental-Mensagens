"""Testes offline (sem rede): validam util e o fluxo real (cadastro -> venda -> matrícula).

Rode:  python -m tests.test_offline   (ou:  pytest tests/ )
"""
import os

# Credenciais fake só para o EvoClient construir sem erro.
os.environ.setdefault("EVO_DNS", "academia-teste")
os.environ.setdefault("EVO_TOKEN", "secret-teste")

from evo_agendamento import EvoClient, TurmaLotadaError, book_experimental  # noqa: E402
from datetime import datetime  # noqa: E402

from evo_agendamento.util import (  # noqa: E402
    extract_email, fmt_date_evo, fmt_datetime_evo, only_digits, parse_datetime,
    parse_when, parse_when_ptbr, same_slot, session_free_general, session_free_spots,
    session_has_room, session_has_room_normal, split_name,
)


class _FakeResp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._payload = payload if payload is not None else {}
        self.content = b"x"
        self.text = str(payload)

    def json(self):
        return self._payload


def _session(date, start, occ, cap, idcfg, idact=122, name="SLIMFIT B"):
    return {"activityDate": f"{date}T00:00:00", "startTime": start, "idActivity": idact,
            "name": name, "idConfiguration": idcfg, "ocupation": occ, "capacity": cap,
            "allowExperimentalClass": False}


def _client_with(routes):
    """Cria um EvoClient com session.request roteado por (method, path)."""
    evo = EvoClient()
    calls = []

    def fake_request(method, url, params=None, json=None, auth=None, timeout=None, headers=None):
        path = url.replace(evo.base_url, "")
        calls.append({"method": method, "path": path, "params": params, "json": json})
        key = (method, path)
        if key not in routes:
            raise AssertionError(f"Chamada inesperada: {method} {path}")
        payload = routes[key]
        return _FakeResp(200, payload() if callable(payload) else payload)

    evo.session.request = fake_request
    return evo, calls


def test_util():
    assert only_digits("(62) 99999-8888") == "62999998888"
    assert split_name("Maria da Silva") == ("Maria", "da Silva")
    assert split_name("Maria") == ("Maria", None)
    assert fmt_datetime_evo("2026-07-10 19:00") == "2026-07-10 19:00"
    assert fmt_datetime_evo("10/07/2026 19:00") == "2026-07-10 19:00"
    assert fmt_date_evo("2026-07-10 19:00") == "2026-07-10"
    assert extract_email("meu email eh maria@ex.com, ok?") == "maria@ex.com"
    assert parse_datetime("2026-07-10").year == 2026
    print("test_util OK")


def test_parse_when_ptbr():
    # sexta-feira 2026-07-03 10:00 como "agora"
    now = datetime(2026, 7, 3, 10, 0)

    d = parse_when_ptbr("segunda às 8h15", now)
    assert d.weekday() == 0 and (d.hour, d.minute) == (8, 15) and d > now
    assert d == datetime(2026, 7, 6, 8, 15)              # próxima segunda

    d = parse_when_ptbr("terça 19:30", now)
    assert d.weekday() == 1 and (d.hour, d.minute) == (19, 30)

    d = parse_when_ptbr("quinta-feira 09h30", now)
    assert d.weekday() == 3 and (d.hour, d.minute) == (9, 30)

    d = parse_when_ptbr("amanhã 07:00", now)
    assert d == datetime(2026, 7, 4, 7, 0)

    d = parse_when_ptbr("dia 17 às 8h", now)
    assert d == datetime(2026, 7, 17, 8, 0)

    # dia já passado no mês -> vai pro mês seguinte
    d = parse_when_ptbr("dia 1 às 20h", now)
    assert d == datetime(2026, 8, 1, 20, 0)

    # mesmo dia da semana, mas hora já passou hoje -> semana que vem
    d = parse_when_ptbr("sexta 08h00", now)
    assert d == datetime(2026, 7, 10, 8, 0)

    # sem hora -> erro (não dá pra agendar)
    try:
        parse_when_ptbr("segunda que vem", now)
        raise AssertionError("deveria exigir hora")
    except ValueError:
        pass

    # parse_when também aceita formato estruturado
    assert parse_when("2026-07-10 16:15") == datetime(2026, 7, 10, 16, 15)
    print("test_parse_when_ptbr OK")


def test_capacity_helpers():
    cheia = _session("2026-07-10", "19:00", 9, 9, 1)
    com_vaga = _session("2026-07-10", "20:00", 5, 9, 2)
    # Vaga "normal" (por capacidade), que é o caso do Studio:
    assert session_free_general(cheia) == 0 and not session_has_room_normal(cheia)
    assert session_free_general(com_vaga) == 4 and session_has_room_normal(com_vaga)
    # Vaga "experimental" (por flag) — flag desligado aqui, então sem vaga:
    assert session_free_spots(com_vaga) == 4 and not session_has_room(com_vaga)
    assert same_slot(com_vaga, "2026-07-10 20:00")
    assert not same_slot(com_vaga, "2026-07-10 19:00")
    print("test_capacity_helpers OK")


def test_book_flow_sells_and_enrolls():
    schedule = [_session("2026-07-10", "19:00", 5, 9, 100)]   # tem vaga
    evo, calls = _client_with({
        ("GET", "/api/v1/activities/schedule"): schedule,
        ("GET", "/api/v1/prospects"): [],                      # não existe -> cria
        ("POST", "/api/v1/prospects"): {"idProspect": 4242},
        ("POST", "/api/v1/sales"): {"idProspect": 4242},
        ("POST", "/api/v1/activities/schedule/enroll"): {"result": "ok"},
    })

    result = book_experimental(
        name="Maria da Silva", when="2026-07-10 19:00",
        email="maria@ex.com", phone="(62) 99999-8888",
        id_activity=122, id_service=128, branch_id=7, evo=evo,
    )

    # vendeu o serviço 128 para o prospect criado, com filial
    sale = next(c for c in calls if c["path"] == "/api/v1/sales")
    assert sale["json"]["idService"] == 128
    assert sale["json"]["idProspect"] == 4242
    assert sale["json"]["idBranch"] == 7
    assert "payment" not in sale["json"]          # EVO_PAYMENT vazio = sem cobrança

    # matriculou na turma certa (idConfiguration + data), pelo prospect
    enroll = next(c for c in calls if c["path"] == "/api/v1/activities/schedule/enroll")
    assert enroll["params"]["idConfiguration"] == 100
    assert enroll["params"]["activityDate"] == "2026-07-10"
    assert enroll["params"]["idProspect"] == 4242

    assert result.id_prospect == 4242 and result.prospect_created is True
    assert result.sold is True and result.enrolled is True
    assert result.id_configuration == 100
    print("test_book_flow_sells_and_enrolls OK")


def test_book_reuses_existing_prospect():
    schedule = [_session("2026-07-10", "19:00", 1, 9, 100)]
    evo, calls = _client_with({
        ("GET", "/api/v1/activities/schedule"): schedule,
        ("GET", "/api/v1/prospects"): [{"idProspect": 555}],   # já existe
        ("POST", "/api/v1/sales"): {},
        ("POST", "/api/v1/activities/schedule/enroll"): {},
    })
    result = book_experimental(
        name="Ana", when="2026-07-10 19:00", email="ana@ex.com",
        id_activity=122, id_service=128, evo=evo,
    )
    assert result.id_prospect == 555 and result.prospect_created is False
    assert not any(c["method"] == "POST" and c["path"] == "/api/v1/prospects" for c in calls)
    print("test_book_reuses_existing_prospect OK")


def test_book_raises_when_full_with_alternatives():
    schedule = [
        _session("2026-07-10", "19:00", 9, 9, 100),   # cheia (horário escolhido)
        _session("2026-07-10", "20:00", 3, 9, 101),   # tem vaga (alternativa)
    ]
    evo, calls = _client_with({("GET", "/api/v1/activities/schedule"): schedule})
    try:
        book_experimental(name="Maria", when="2026-07-10 19:00",
                          id_activity=122, id_service=128, evo=evo)
        raise AssertionError("Deveria ter levantado TurmaLotadaError")
    except TurmaLotadaError as e:
        assert e.alternatives and e.alternatives[0]["when"] == "2026-07-10 20:00"
        assert e.alternatives[0]["freeSpots"] == 6
    # não pode ter cadastrado/vendido/matriculado
    assert all(c["method"] == "GET" for c in calls)
    print("test_book_raises_when_full_with_alternatives OK")


def test_book_raises_when_no_session_at_time():
    schedule = [_session("2026-07-10", "20:00", 3, 9, 101)]   # só tem 20:00
    evo, _ = _client_with({("GET", "/api/v1/activities/schedule"): schedule})
    try:
        book_experimental(name="Maria", when="2026-07-10 19:00",
                          id_activity=122, id_service=128, evo=evo)
        raise AssertionError("Deveria ter levantado TurmaLotadaError")
    except TurmaLotadaError as e:
        assert "não há turma" in e.reason
        assert e.alternatives[0]["when"] == "2026-07-10 20:00"
    print("test_book_raises_when_no_session_at_time OK")


def test_notify_studio_full_builds_message():
    from evo_agendamento.orchestrator import notify_studio_full

    sent = {}

    class FakeZee:
        def notify_phone(self, phone, text, name=None):
            sent.update(phone=phone, text=text, name=name)
            return {"statusCode": 0}

    # turma lotada
    ok = notify_studio_full(
        FakeZee(), name="Maria da Silva", phone="62999998888", when="2026-07-10 19:00",
        alternatives=[{"when": "2026-07-11 19:00", "freeSpots": 2}], reason="sem vaga",
        studio_phone="5562985508065",
    )
    assert ok is True and sent["phone"] == "5562985508065"
    for token in ("Maria da Silva", "62999998888", "19:00", "LOTADA", "2026-07-11 19:00"):
        assert token in sent["text"]

    # turma inexistente -> template diferente
    notify_studio_full(FakeZee(), name="Ana", phone="61", when="2026-07-10 19:00",
                       reason="não há turma nesse horário", studio_phone="556299")
    assert "INEXISTENTE" in sent["text"]
    print("test_notify_studio_full_builds_message OK")


def test_notify_studio_skips_without_phone():
    from evo_agendamento import config
    from evo_agendamento.orchestrator import notify_studio_full

    class FakeZee:
        def notify_phone(self, *a, **k):
            raise AssertionError("não deveria enviar sem studio_phone")

    original = config.ZEE_STUDIO_PHONE
    config.ZEE_STUDIO_PHONE = ""
    try:
        assert notify_studio_full(FakeZee(), name="X", phone="1",
                                  when="2026-07-10 19:00", studio_phone="") is False
    finally:
        config.ZEE_STUDIO_PHONE = original
    print("test_notify_studio_skips_without_phone OK")


class _FakeZee:
    def __init__(self, contacts):
        self.contacts = contacts
        self.tagged = []
        self.notified = []
        self.messages = []

    def list_threads(self, **kw):
        return [{"contactId": cid} for cid in self.contacts]

    def get_contact(self, contact_id=None, phone=None):
        return self.contacts.get(contact_id)

    def get_summary(self, cid, **kw):
        return None

    def set_contact_tag(self, contact_id, tags, override=False):
        self.tagged.append((contact_id, tags))

    def notify_phone(self, phone, text, name=None):
        self.notified.append(phone)

    def send_message(self, contact_id, text):
        self.messages.append((contact_id, text))


def test_process_pending_loop():
    from datetime import datetime as _dt

    from evo_agendamento import config as cfg
    from evo_agendamento import process_pending

    TODO = "FX 3 - Agendou AE"      # o GET /contact devolve o NOME da tag
    DONE = "FX 4 - Feito"
    DONE_ID = "a7cf28be-e50f-4a47-b6ed-7ab20d4245b7"   # set-contact-tag usa o ID

    contacts = {
        # agenda: tem TODO, sem DONE, com horário
        "c1": {"id": "c1", "name": "Maria Silva", "phone": "5562999990000",
               "tags": [TODO], "metadata": {"email": "m@x.com", "horario": "2026-07-06 08:15"}},
        # ignora: não tem a tag TODO
        "c2": {"id": "c2", "name": "Ana", "tags": ["outra"], "metadata": {}},
        # pula: já tem DONE
        "c3": {"id": "c3", "name": "Ju", "tags": [TODO, DONE],
               "metadata": {"horario": "2026-07-06 08:15"}},
        # skipped: falta horário
        "c4": {"id": "c4", "name": "Bia", "tags": [TODO], "metadata": {"email": "b@x.com"}},
    }

    evo, _ = _client_with({
        ("GET", "/api/v1/activities/schedule"): [_session("2026-07-06", "08:15", 4, 9, 777)],
        ("GET", "/api/v1/prospects"): [],
        ("POST", "/api/v1/prospects"): {"idProspect": 1},
        ("POST", "/api/v1/sales"): {},
        ("POST", "/api/v1/activities/schedule/enroll"): {},
    })
    zee = _FakeZee(contacts)

    original = cfg.EVO_SERVICE_ID
    original_ch = cfg.STUDIO_CONFIRM_CHANNEL
    cfg.EVO_SERVICE_ID = "128"
    cfg.STUDIO_CONFIRM_CHANNEL = "zee"   # no teste, confirma pela ZEE p/ inspecionar a msg
    try:
        res = process_pending(zee=zee, evo=evo, todo_tag=TODO, done_tag=DONE,
                              done_tag_id=DONE_ID, now=_dt(2026, 7, 3, 10, 0))
    finally:
        cfg.EVO_SERVICE_ID = original
        cfg.STUDIO_CONFIRM_CHANNEL = original_ch

    # só a c1 foi agendada
    assert [p["contactId"] for p in res["processed"]] == ["c1"]
    assert res["processed"][0]["idProspect"] == 1
    # marcou a tag "feito" (pelo ID) na c1
    assert ("c1", DONE_ID) in zee.tagged
    # enviou a confirmação pra aluna (c1), com o horário amigável
    assert zee.messages and zee.messages[0][0] == "c1"
    assert "08:15" in zee.messages[0][1]
    # c4 caiu em skipped (sem horário); c2 e c3 nem entram
    assert [s["contactId"] for s in res["skipped"]] == ["c4"]
    assert not any(t[0] in ("c2", "c3") for t in zee.tagged)
    print("test_process_pending_loop OK")


def test_confirm_outbox_writes_queue():
    import json as _json
    import tempfile

    from evo_agendamento import config as cfg
    from evo_agendamento.orchestrator import _confirm_aluna

    tmp = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8")
    tmp.close()
    o_ch, o_file = cfg.STUDIO_CONFIRM_CHANNEL, cfg.STUDIO_OUTBOX_FILE
    cfg.STUDIO_CONFIRM_CHANNEL = "outbox"
    cfg.STUDIO_OUTBOX_FILE = tmp.name
    try:
        canal = _confirm_aluna(zee=None, cid="c1", name="Juliana Rabadan",
                               phone="(62) 8171-8205", when="2026-07-10 16:15")
        assert canal == "outbox"
        with open(tmp.name, encoding="utf-8") as f:
            row = _json.loads(f.readline())
        assert row["phone"] == "62981718205"          # só dígitos
        assert row["status"] == "pending"
        assert "16:15" in row["message"] and "Setor Bueno" in row["message"]
    finally:
        cfg.STUDIO_CONFIRM_CHANNEL, cfg.STUDIO_OUTBOX_FILE = o_ch, o_file
        os.unlink(tmp.name)
    print("test_confirm_outbox_writes_queue OK")


def test_booking_data_from_summary_json():
    from evo_agendamento.orchestrator import booking_data_from_contact

    contact = {"id": "x", "phone": "556284301644", "displayName": "Bruna 🌸",
               "name": None, "metadata": None}
    # resumo do ZEE já no formato JSON (com cerca de código, pra testar a limpeza)
    summary = ('```json\n{"nome_completo": "Bruna Souza de Melo", '
               '"email": "brunaletrasufg@gmail.com", "dia": "segunda-feira", '
               '"hora": "16:15", "resumo": "quer aula experimental"}\n```')
    d = booking_data_from_contact(contact, summary)
    assert d["name"] == "Bruna Souza de Melo"
    assert d["email"] == "brunaletrasufg@gmail.com"
    assert d["phone"] == "556284301644"
    assert d["when"] == "segunda-feira 16:15"
    # e o when é interpretável para uma data real
    assert parse_when(d["when"], datetime(2026, 7, 3, 10, 0)) == datetime(2026, 7, 6, 16, 15)

    # resumo em texto solto (sem JSON) -> fallback, sem horário
    d2 = booking_data_from_contact(contact, "O usuário deseja agendar uma aula...")
    assert d2["when"] is None
    print("test_booking_data_from_summary_json OK")


def test_clean_ignores_inline_comment():
    from evo_agendamento.config import _clean
    os.environ["_X_TEST_BRANCH"] = "            # obrigatório só em chave multi-filial"
    assert _clean("_X_TEST_BRANCH") == ""
    os.environ["_X_TEST_BRANCH"] = "7"
    assert _clean("_X_TEST_BRANCH") == "7"
    del os.environ["_X_TEST_BRANCH"]
    print("test_clean_ignores_inline_comment OK")


if __name__ == "__main__":
    test_util()
    test_parse_when_ptbr()
    test_capacity_helpers()
    test_book_flow_sells_and_enrolls()
    test_book_reuses_existing_prospect()
    test_book_raises_when_full_with_alternatives()
    test_book_raises_when_no_session_at_time()
    test_notify_studio_full_builds_message()
    test_notify_studio_skips_without_phone()
    test_process_pending_loop()
    test_confirm_outbox_writes_queue()
    test_booking_data_from_summary_json()
    test_clean_ignores_inline_comment()
    print("\nTodos os testes offline passaram. ✅")
