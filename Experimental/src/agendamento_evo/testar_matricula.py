# testar_matricula.py
# Testa SÓ a matrícula (enroll) numa turma, sem criar prospect nem vender de novo.
# Use para checar se o EVO já permite agendar 01/08 08:30 depois de mudar a antecedência.
#
# Rodar na pasta agendamento_evo (a mesma do run_agendamento.py):
#   python testar_matricula.py
#
# Ajuste DATA/HORA e ID_PROSPECT abaixo se precisar.

import os
from datetime import datetime

# --- carrega .env (mesma pasta) ---
if os.path.exists(".env"):
    for line in open(".env", encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from evo_agendamento.evo_client import EvoClient, EvoError
from evo_agendamento.util import same_slot, fmt_datetime_evo

# ======== AJUSTE AQUI SE PRECISAR ========
QUANDO = datetime(2026, 8, 1, 8, 30)   # sábado 01/08 às 08:30
ID_PROSPECT = 44533                    # Gabriela (já cadastrada e com a venda feita)
# =========================================

evo = EvoClient()

print(f"Consultando agenda para {fmt_datetime_evo(QUANDO)} ...")
sched = evo.list_schedule(QUANDO, show_full_week=True)
print(f"  {len(sched)} turma(s) retornada(s) pela agenda.")

sessao = next((s for s in sched if same_slot(s, QUANDO)), None)
if not sessao:
    print("\n>>> Nenhuma turma bate com essa data/hora. Turmas próximas retornadas:")
    for s in sched[:15]:
        print("   -", s.get("activityDate"), s.get("startTime"),
              "| idConfig=", s.get("idConfiguration"),
              "| cap=", s.get("capacity"), "ocup=", s.get("ocupation"),
              "|", s.get("name"))
    raise SystemExit(1)

idc = sessao.get("idConfiguration")
print(f"  Turma encontrada: idConfiguration={idc} | "
      f"cap={sessao.get('capacity')} ocup={sessao.get('ocupation')} | {sessao.get('name')}")

print(f"\nTentando matricular idProspect={ID_PROSPECT} ...")
try:
    r = evo.enroll_schedule(idc, activity_date=QUANDO, id_prospect=ID_PROSPECT)
    print("\n✅ SUCESSO! Matrícula feita. Resposta do EVO:", r)
except EvoError as e:
    print("\n❌ FALHOU. Erro do EVO:")
    print("   ", str(e))
