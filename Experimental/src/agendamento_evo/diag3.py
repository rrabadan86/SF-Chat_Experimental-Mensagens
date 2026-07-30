# diag3.py — descobre por que a conversa da Taynara nao aparece no /threads.
# Rodar na pasta agendamento_evo:  python diag3.py

import json
from datetime import datetime, timedelta
from evo_agendamento.zee_client import ZeeClient

ID = "69bf9a25-5260-4d18-9405-aaa3e8bd1836"   # id da URL do chat dela
z = ZeeClient()

print("=== get_contact(ID) ===")
c = z.get_contact(contact_id=ID) or {}
print(json.dumps(c, ensure_ascii=False)[:700])
real_cid = c.get("id")
print(">> id REAL do contato (campo 'id'):", real_cid)

print("\n=== ID e um threadId? (GET /thread/{ID}) ===")
try:
    th = z._request("GET", f"/thread/{ID}")
    print(json.dumps(th, ensure_ascii=False)[:400])
    print(">> contactId DESSE thread:", (th or {}).get("contactId"))
except Exception as e:
    print("erro:", e)

print("\n=== a conversa dela esta nas 24h de /threads? ===")
cutoff = (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
ts = z.list_threads(since=cutoff)
cids = set(t.get("contactId") for t in ts)
print("total threads:", len(ts))
print("ID nas threads?      ", ID in cids)
print("real_cid nas threads?", real_cid in cids)

print("\n=== 12 conversas MAIS RECENTES (startDate | contactId) ===")
recent = sorted(ts, key=lambda t: t.get("startDate") or "", reverse=True)[:12]
for t in recent:
    print("  ", t.get("startDate"), "|", t.get("contactId"), "| status:", t.get("status"))
