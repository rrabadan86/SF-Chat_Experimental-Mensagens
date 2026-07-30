#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO 4 (final): lista TODOS os participantes da turma das 19:30 e mostra,
para cada um, os campos que separam MATRÍCULA de AULA EXPERIMENTAL.

Endpoint confirmado:
    GET /api/v1/activities/schedule/detail?idActivitySession=143018

Objetivo: confirmar que Rosalina e Ana Beatriz (as experimentais) têm idProspect
preenchido (e idMember vazio), para eu contar os experimentais com segurança.

Só LEITURA. Rode na pasta agendamento_evo (com o .env):
    python diag_enrollments.py
    python diag_enrollments.py --sessao 143018
    python diag_enrollments.py --idconfig 1201 --data 2026-07-23
"""
import argparse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessao", default="143018")   # idAtividadeSessao
    ap.add_argument("--idconfig", default=None)
    ap.add_argument("--data", default=None)          # yyyy-MM-dd
    args = ap.parse_args()

    from evo_agendamento import EvoClient
    evo = EvoClient()

    if args.idconfig and args.data:
        params = {"idConfiguration": args.idconfig, "activityDate": f"{args.data}T00:00:00"}
    else:
        params = {"idActivitySession": args.sessao}

    url = f"{evo.base_url}/api/v1/activities/schedule/detail"
    resp = evo.session.request("GET", url, params=params, auth=evo.auth,
                               timeout=evo.timeout, headers={"Accept": "application/json"})
    print(f"HTTP {resp.status_code}  params={params}\n")
    if resp.status_code != 200:
        print("Sem conteúdo. Tente: python diag_enrollments.py --idconfig 1201 --data 2026-07-23")
        return

    data = resp.json() or {}
    enr = data.get("enrollments") or []
    print(f"Turma: {data.get('name')}  {data.get('startTime')}  "
          f"capacity={data.get('capacity')} ocupation={data.get('ocupation')}")
    print(f"Total de enrollments: {len(enr)}\n")

    print(f"{'NOME':<34} {'idMember':>9} {'idProspect':>11} {'idEmployee':>11} "
          f"{'status':>7} {'idSaleItem':>11}  -> palpite")
    print("-" * 110)
    exp = 0
    for e in enr:
        idm, idp, ide = e.get("idMember"), e.get("idProspect"), e.get("idEmployee")
        # palpite: experimental = tem idProspect (é oportunidade), não é membro
        eh_exp = bool(idp) and not idm
        if eh_exp:
            exp += 1
        print(f"{(e.get('name') or '')[:33]:<34} {str(idm):>9} {str(idp):>11} {str(ide):>11} "
              f"{str(e.get('status')):>7} {str(e.get('idSaleItem')):>11}  -> "
              f"{'EXPERIMENTAL' if eh_exp else 'matrícula'}")

    print("-" * 110)
    print(f"\n>> Contagem pelo palpite (idProspect preenchido e sem idMember): {exp} experimental(is)")
    print(">> Confirme com o painel: nesse horário devem ser 2 (Rosalina e Ana Beatriz).")
    print(">> Me manda esta tabela que eu fecho a regra de contagem e implemento o limite.")


if __name__ == "__main__":
    main()
