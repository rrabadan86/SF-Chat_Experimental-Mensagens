#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO 2: descobrir COMO listar os participantes de uma turma no EVO,
para contar quantos são "Aula Experimental" (e assim bloquear quando já houver 2).

A agenda (list_schedule) não separa experimental de matrícula. Este script TENTA
vários endpoints/parâmetros prováveis da API do EVO para trazer a lista de
participantes/inscrições da turma das 19:30 (idConfiguration=1201, sessão=143018,
data 2026-07-23) e mostra QUAL deles funciona e o formato da resposta.

É só LEITURA (GET) — não altera nada.

COMO USAR (dentro da pasta agendamento_evo, com o .env):
    python diag_participantes.py
    python diag_participantes.py --idconfig 1201 --sessao 143018 --data 2026-07-23

Me manda a saída inteira. Vou procurar o endpoint que devolve os participantes
com o TIPO (Matrícula x Aula Experimental).
"""
import argparse
import json

from evo_agendamento import EvoClient


def snippet(obj, n=1400):
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        s = str(obj)
    return s if len(s) <= n else s[:n] + " …(cortado)"


def tentar(evo, method, path, params):
    """GET cru que NÃO levanta erro — imprime status e um trecho da resposta."""
    url = f"{evo.base_url}{path}"
    try:
        resp = evo.session.request(
            method, url, params={k: v for k, v in params.items() if v not in (None, "")},
            auth=evo.auth, timeout=evo.timeout, headers={"Accept": "application/json"},
        )
    except Exception as e:
        print(f"  [ERRO conexão] {method} {path}  params={params}\n     {e}")
        return
    print(f"\n  {method} {path}  params={params}")
    print(f"     HTTP {resp.status_code}")
    body = None
    try:
        body = resp.json()
    except ValueError:
        body = (resp.text or "").strip()
    # se veio lista, diz o tamanho; se dict, mostra as chaves
    if isinstance(body, list):
        print(f"     -> LISTA com {len(body)} item(ns)")
        if body:
            print(f"     -> 1º item: {snippet(body[0])}")
    elif isinstance(body, dict):
        print(f"     -> DICT chaves: {list(body.keys())}")
        print(f"     -> {snippet(body)}")
    else:
        print(f"     -> {snippet(body)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idconfig", default="1201")
    ap.add_argument("--sessao", default="143018")   # idAtividadeSessao
    ap.add_argument("--data", default="2026-07-23")
    args = ap.parse_args()

    evo = EvoClient()
    idc, ses, data = args.idconfig, args.sessao, args.data
    print(f"Procurando participantes da turma idConfiguration={idc}, sessão={ses}, data={data}\n")

    # 1) a própria agenda, mas pedindo UMA turma/dia (será que 'spots' vem preenchido?)
    tentar(evo, "GET", "/api/v1/activities/schedule",
           {"date": data, "idConfiguration": idc, "showFullWeek": False, "onlyAvailables": False})

    # 2/3/4) endpoints prováveis de inscrições/participantes por turma
    tentar(evo, "GET", "/api/v1/activities/schedule/enrollments",
           {"idConfiguration": idc, "date": data})
    tentar(evo, "GET", "/api/v1/activities/schedule/enrollments",
           {"idActivitySession": ses})
    tentar(evo, "GET", "/api/v1/activities/schedule/detail",
           {"idConfiguration": idc, "date": data})

    # 5) sessão específica pelo id da sessão do dia
    tentar(evo, "GET", "/api/v1/activities/schedule/session",
           {"idActivitySession": ses})

    # 6) inscrições de atividades (outra convenção comum)
    tentar(evo, "GET", "/api/v1/activities/enrollments",
           {"idConfiguration": idc, "date": data})

    # 7) "members" numa sessão (menos provável, mas testamos)
    tentar(evo, "GET", "/api/v1/members/schedule",
           {"idConfiguration": idc, "date": data})

    print("\n----------------------------------------------------------------")
    print("Me manda TODA a saída. Procuro um endpoint que devolva a LISTA de")
    print("participantes com o TIPO (matrícula x aula experimental) — algo como")
    print("um campo 'type', 'origin', 'experimental', 'nameService' ou parecido.")


if __name__ == "__main__":
    main()
