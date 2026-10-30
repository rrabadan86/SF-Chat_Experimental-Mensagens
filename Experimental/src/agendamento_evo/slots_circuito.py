"""Grade da aula experimental do CIRCUITO SLIM (Cadastro Express do painel).

A grade do SlimFit vai pronta para o formulário (push_slots.py); a do circuito é
pedida pelo painel só quando a recepção escolhe "Circuito Slim" — poucas chamadas
ao EVO (uma por semana). Imprime JSON: {"dias": {"AAAA-MM-DD": [{time, freeSpots,
disponivel, ...}]}} — o mesmo formato do /api/slots do formulário.

Uso (na pasta agendamento_evo):  .venv/bin/python slots_circuito.py [dias]
"""
import json
import sys

from evo_agendamento import available_slots


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 10
    slots = available_slots(days=days, use_cache=False, circuito=True)
    dias = {}
    for s in slots:
        dias.setdefault(s["date"], []).append({
            "idConfiguration": s["idConfiguration"], "activityDate": s["activityDate"], "time": s["time"],
            "activity": s["activity"], "disponivel": s["disponivel"], "freeSpots": s["freeSpots"],
        })
    print(json.dumps({"ok": True, "dias": dias}, ensure_ascii=False))


if __name__ == "__main__":
    main()
