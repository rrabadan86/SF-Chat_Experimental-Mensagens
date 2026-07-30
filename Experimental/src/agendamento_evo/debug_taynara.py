# debug_taynara.py
# Descobre por que a Taynara (e talvez outros com FX 3) nao esta sendo agendada.
# Roda na pasta agendamento_evo:  python debug_taynara.py

import json
from datetime import datetime, timedelta
from evo_agendamento.zee_client import ZeeClient
from evo_agendamento import config

ID_URL = "69bf9a25-5260-4d18-9405-aaa3e8bd1836"   # id da URL do chat da Taynara
z = ZeeClient()

print("TAG que o job procura (config.ZEE_TAG_TODO):", repr(config.ZEE_TAG_TODO))
print("=" * 60)

# 1) O id da URL funciona como contactId? Mostra as tags dela.
try:
    c = z.get_contact(contact_id=ID_URL)
    print("get_contact pelo id da URL:")
    print("  name:", (c or {}).get("name"))
    print("  tags:", json.dumps((c or {}).get("tags"), ensure_ascii=False))
except Exception as e:
    print("get_contact pelo id da URL FALHOU:", e)

print("=" * 60)

# 2) Varre as conversas recentes e lista quem tem FX 3 (match solto, so p/ achar).
since = (datetime.now(datetime.now().astimezone().tzinfo) - timedelta(hours=24))
since = since.astimezone().strftime("%Y-%m-%dT%H:%M:%S.000Z")
try:
    ts = z.list_threads(since=since)
except TypeError:
    ts = z.list_threads()
cids, seen = [], set()
for t in ts:
    cc = (t or {}).get("contactId")
    if cc and cc not in seen:
        seen.add(cc)
        cids.append(cc)
print(f"threads recentes: {len(ts)} | contatos unicos: {len(cids)}")
print(f"O id da URL esta entre os contatos das conversas? {ID_URL in seen}")

print("-- procurando contatos com FX 3 (pode demorar, sao muitos get_contact) --")
achei = []
for cc in cids:
    try:
        ct = z.get_contact(contact_id=cc) or {}
    except Exception:
        continue
    tags = ct.get("tags") or []
    if any(("fx 3" in str(x).lower()) or ("agendou" in str(x).lower()) for x in tags):
        achei.append({"contactId": cc, "name": ct.get("name"), "tags": tags})

print(f"\nCONTATOS COM FX 3 encontrados: {len(achei)}")
for a in achei:
    print(" ", json.dumps(a, ensure_ascii=False))
