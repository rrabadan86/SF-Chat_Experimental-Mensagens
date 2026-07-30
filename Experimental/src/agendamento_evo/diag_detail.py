#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO 3 (focado): o endpoint /api/v1/activities/schedule/detail EXISTE
(devolveu 204). Aqui testamos várias combinações de parâmetros e formatos de data
para fazê-lo devolver os PARTICIPANTES da turma das 19:30 (com o tipo: matrícula x
aula experimental). Também tenta algumas rotas alternativas.

Só LEITURA (GET). Rode dentro da pasta agendamento_evo (com o .env):
    python diag_detail.py
    python diag_detail.py --idconfig 1201 --sessao 143018 --data 2026-07-23
"""
import argparse
import json


def snippet(obj, n=1800):
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        s = str(obj)
    return s if len(s) <= n else s[:n] + " …(cortado)"


def tentar(evo, path, params):
    url = f"{evo.base_url}{path}"
    try:
        resp = evo.session.request(
            "GET", url, params={k: v for k, v in params.items() if v not in (None, "")},
            auth=evo.auth, timeout=evo.timeout, headers={"Accept": "application/json"},
        )
    except Exception as e:
        print(f"  [ERRO] GET {path} {params}\n     {e}")
        return
    status = resp.status_code
    body = None
    try:
        body = resp.json()
    except ValueError:
        body = (resp.text or "").strip()
    tag = ""
    if isinstance(body, list):
        tag = f"LISTA[{len(body)}]"
    elif isinstance(body, dict):
        tag = f"DICT{list(body.keys())}"
    marca = "   <<< TEM CONTEÚDO!" if (status == 200 and body not in (None, "", [], {})) else ""
    print(f"  HTTP {status}  {tag}  ::  GET {path}  {params}{marca}")
    if status == 200 and body not in (None, "", [], {}):
        print(f"       {snippet(body)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idconfig", default="1201")
    ap.add_argument("--sessao", default="143018")
    ap.add_argument("--data", default="2026-07-23")
    args = ap.parse_args()

    from evo_agendamento import EvoClient
    evo = EvoClient()
    idc, ses = args.idconfig, args.sessao
    d = args.data                 # 2026-07-23
    diso = f"{d}T00:00:00"        # 2026-07-23T00:00:00

    print(f"Testando /detail e variações — turma idConfiguration={idc}, sessão={ses}, data={d}\n")

    print("== /api/v1/activities/schedule/detail (varias combinações) ==")
    combos = [
        {"idConfiguration": idc, "date": d},
        {"idConfiguration": idc, "date": diso},
        {"idConfiguration": idc, "activityDate": d},
        {"idConfiguration": idc, "activityDate": diso},
        {"idActivitySession": ses},
        {"idConfiguration": idc, "idActivitySession": ses},
        {"idConfiguration": idc, "idActivitySession": ses, "date": d},
        {"idConfiguration": idc, "idActivitySession": ses, "date": diso},
    ]
    for c in combos:
        tentar(evo, "/api/v1/activities/schedule/detail", c)

    print("\n== rotas alternativas ==")
    tentar(evo, "/api/v1/activities/enrollments", {"idActivitySession": ses})
    tentar(evo, "/api/v1/activities/enrollments", {"idConfiguration": idc, "activityDate": diso})
    tentar(evo, "/api/v1/activities/schedule/participants", {"idConfiguration": idc, "date": d})
    tentar(evo, "/api/v1/activities/schedule/bookings", {"idConfiguration": idc, "date": d})
    tentar(evo, "/api/v1/activities/schedule", {"idActivitySession": ses, "onlyAvailables": False})

    print("\n----------------------------------------------------------------")
    print("Me manda a saída. Se alguma linha mostrar '<<< TEM CONTEÚDO!', achamos")
    print("o endpoint dos participantes — e eu implemento a contagem de experimentais.")


if __name__ == "__main__":
    main()
