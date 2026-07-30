# testar_resumo.py
# Diagnóstico: acha as conversas (threads) da Geslaine e mostra o resumo que
# o ZEE devolve para o threadId de cada uma. Assim descobrimos se o /summary
# realmente filtra por threadId (ou se ignora e sempre volta a mais antiga).
#
# Rodar na pasta agendamento_evo:
#   python testar_resumo.py

import json
from evo_agendamento.zee_client import ZeeClient

CID = "1b3956d1-07c5-4111-9707-74d06b1a78a6"   # Geslaine
MAX_PAGES = 40

z = ZeeClient()

found = []
p = 0
for page in range(1, MAX_PAGES + 1):
    batch = z._request("GET", "/threads", params={"page": page}) or []
    p = page
    if not batch:
        break
    found += [t for t in batch if t.get("contactId") == CID]

print(f"paginas lidas: {p} | threads da Geslaine encontrados: {len(found)}")
print(json.dumps(found, ensure_ascii=False, indent=1))

print("\n--- resumo por threadId ---")
for t in found:
    r = z._request("GET", f"/summary/{CID}", params={"threadId": t.get("id")})
    print("thread", t.get("startDate"), t.get("status"), "->",
          json.dumps(r, ensure_ascii=False)[:300])

print("\n--- resumo SEM threadId (padrao) ---")
print(json.dumps(z._request("GET", f"/summary/{CID}"), ensure_ascii=False)[:300])
