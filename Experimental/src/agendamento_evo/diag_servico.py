"""DIAGNÓSTICO (só leitura) — quais ATIVIDADES um serviço do EVO libera?

A experimental do Circuito Slim vende um serviço (ex.: 316) e matricula numa turma.
Se o serviço não liberar a atividade da turma, o EVO recusa:
"This member has no sessions for this activity".

Uso (na pasta agendamento_evo):
    .venv/bin/python diag_servico.py 316        → mostra o serviço 316
    .venv/bin/python diag_servico.py             → lista os serviços de experimental
"""
import json
import sys

from evo_agendamento import EvoClient


def resumo_ativ(a):
    if not isinstance(a, dict):
        return str(a)
    return f"{a.get('idActivity') or a.get('id')} · {a.get('name') or a.get('nameActivity') or a.get('description') or '?'}"


def main():
    evo = EvoClient()
    alvo = sys.argv[1] if len(sys.argv) > 1 else ""
    servs = evo.list_services() or []
    if alvo:
        s = next((x for x in servs if str(x.get("idService")) == alvo), None)
        if not s:
            print(f"Serviço {alvo} não apareceu na lista do EVO ({len(servs)} serviços lidos).")
            return
        print(f"Serviço {s.get('idService')} · {s.get('nameService')} · experimentalClass={s.get('experimentalClass')}")
        acts = s.get("activities") or s.get("activitiesService") or []
        print("Atividades liberadas:", "; ".join(resumo_ativ(a) for a in acts) if acts else "(nenhuma informada pelo EVO)")
        print("Campos do serviço:", ", ".join(sorted(s.keys())))
        print("activityGroups:", json.dumps(s.get("activityGroups"), ensure_ascii=False)[:1500])
        # Para comparar: o serviço da experimental do SlimFit (o que funciona)
        from evo_agendamento import config
        sf = next((x for x in servs if str(x.get("idService")) == str(config.EVO_SERVICE_ID or "")), None)
        if sf:
            print(f"\nComparação — serviço do SlimFit {sf.get('idService')} · {sf.get('nameService')}")
            print("activityGroups:", json.dumps(sf.get("activityGroups"), ensure_ascii=False)[:1500])
    else:
        for s in servs:
            if s.get("experimentalClass") or "experim" in str(s.get("nameService") or "").lower():
                acts = s.get("activities") or []
                print(f"{s.get('idService')} · {s.get('nameService')} → {'; '.join(resumo_ativ(a) for a in acts) or '(sem atividades)'}")
    # Atividades da academia (para comparar com as turmas de circuito)
    print("\nAtividades com 'circuito' no nome (todos os campos, para ver o grupo):")
    for a in evo.list_activities(search="circuito") or []:
        print("  ", resumo_ativ(a))
        print("     ", json.dumps({k: v for k, v in a.items() if not isinstance(v, (list, dict)) or "group" in k.lower()}, ensure_ascii=False)[:800])
    print("\nAtividades com 'slim' no nome (o SlimFit, para comparar):")
    for a in evo.list_activities(search="slim") or []:
        if "circuito" in str(a.get("name") or "").lower():
            continue
        print("  ", resumo_ativ(a))
        print("     ", json.dumps({k: v for k, v in a.items() if not isinstance(v, (list, dict)) or "group" in k.lower()}, ensure_ascii=False)[:800])


if __name__ == "__main__":
    main()
