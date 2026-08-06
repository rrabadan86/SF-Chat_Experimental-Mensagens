"""Diagnóstico (SÓ LEITURA) de um cadastro no EVO.

Mostra se a pessoa já existe e quais campos estão preenchidos — serve para
confirmar por que CPF/nascimento do formulário não aparecem no EVO: quando o
cadastro JÁ EXISTE, o agendamento reaproveita o registro e não atualiza nada.

Uso (no VPS):
    cd ~/SF-Chat_Experimental-Mensagens/Experimental/src/agendamento_evo
    .venv/bin/python diag_prospect.py --phone 62999998888
    .venv/bin/python diag_prospect.py --email fulana@email.com

Não altera nada no EVO.
"""
import argparse
import json

from evo_agendamento import EvoClient

INTERESSE = ["idProspect", "name", "lastName", "email", "cellphone", "document",
             "birthday", "cpf", "dateOfBirth", "idMember"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--phone")
    p.add_argument("--email")
    p.add_argument("--full", action="store_true", help="mostra o registro inteiro")
    args = p.parse_args()

    if not args.phone and not args.email:
        p.error("informe --phone e/ou --email")

    evo = EvoClient()
    achados = evo.find_prospects(email=args.email, phone=args.phone) or []
    if not achados and args.phone:
        # tenta também sem normalizar o 9 (cadastros antigos)
        achados = evo.find_prospects(phone=args.phone, normalize_phone=False) or []

    print(f"\n{len(achados)} cadastro(s) encontrado(s).\n")
    if not achados:
        print("→ Pessoa NÃO existe no EVO. Nesse caso o formulário CRIA o cadastro")
        print("  e envia CPF + nascimento + e-mail normalmente.")
        return

    for i, pr in enumerate(achados):
        print(f"── cadastro {i + 1} ──")
        # Procura QUAL campo guarda o CPF (valor com 11 dígitos). É assim que
        # descobrimos o nome correto que a API do EVO usa para o CPF.
        candidatos = []
        for k, v in pr.items():
            if v is None:
                continue
            so_num = "".join(ch for ch in str(v) if ch.isdigit())
            if len(so_num) == 11 and "phone" not in k.lower() and "cell" not in k.lower():
                candidatos.append((k, v))
        if candidatos:
            print("   🔎 CAMPO(S) COM CARA DE CPF (11 dígitos):")
            for k, v in candidatos:
                print(f"        {k} = {v!r}   ← use este nome no cadastro")
        else:
            print("   🔎 nenhum campo com 11 dígitos (esse cadastro está SEM CPF)")

        if args.full:
            print(json.dumps(pr, indent=2, ensure_ascii=False)[:3000])
        else:
            for k in INTERESSE:
                if k in pr:
                    v = pr.get(k)
                    marca = "VAZIO ⚠️" if v in (None, "", 0) else repr(v)
                    print(f"   {k:14s} = {marca}")
            outros = [k for k in pr.keys() if k not in INTERESSE]
            print(f"   (outros campos: {', '.join(outros[:20])})")
        print()

    print("→ Pessoa JÁ EXISTE. O agendamento reaproveita este cadastro e NÃO")
    print("  atualiza CPF/nascimento — por isso os dados do formulário se perdem.")


if __name__ == "__main__":
    main()
