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


def _campos_com_cpf(reg):
    """Devolve [(campo, valor)] cujos valores parecem CPF (11 dígitos)."""
    out = []
    for k, v in (reg or {}).items():
        if v is None or isinstance(v, (list, dict)):
            continue
        so_num = "".join(ch for ch in str(v) if ch.isdigit())
        if len(so_num) == 11 and not any(t in k.lower() for t in ("phone", "cell", "ddi")):
            out.append((k, v))
    return out


def _diag_clientes(evo, args):
    """Procura em /api/v1/members (clientes/alunas) — é lá que o CPF costuma estar.
    Tenta alguns nomes de parâmetro porque a API varia. Só leitura."""
    print("\n═══ BUSCA EM CLIENTES (/api/v1/members) ═══")
    tentativas = []
    if args.cpf:
        so = "".join(ch for ch in args.cpf if ch.isdigit())
        tentativas += [{"document": so}, {"cpf": so}, {"name": so}]
    if args.email:
        tentativas.append({"email": args.email})
    if args.phone:
        so = "".join(ch for ch in args.phone if ch.isdigit())
        tentativas += [{"phone": so}, {"cellphone": so}]

    for params in tentativas:
        params = dict(params, take=10)
        try:
            data = evo._request("GET", "/api/v1/members", params=params)
        except Exception as e:
            print(f"   {params} -> erro: {e}")
            continue
        regs = data if isinstance(data, list) else (data or {}).get("list") or []
        print(f"   {params} -> {len(regs)} resultado(s)")
        if not regs:
            continue
        reg = regs[0]
        achados = _campos_com_cpf(reg)
        if achados:
            print("   🔎 CAMPO(S) COM CARA DE CPF:")
            for k, v in achados:
                print(f"        {k} = {v!r}   ← nome do campo usado pelo EVO")
        else:
            print("   (nenhum campo com 11 dígitos neste registro)")
        print("   campos disponíveis:", ", ".join(list(reg.keys())[:40]))
        if args.full:
            print(json.dumps(reg, indent=2, ensure_ascii=False)[:2500])
        return
    print("   nada encontrado em clientes.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--phone")
    p.add_argument("--email")
    p.add_argument("--cpf", help="busca o CLIENTE por CPF (quem já é aluna)")
    p.add_argument("--full", action="store_true", help="mostra o registro inteiro")
    args = p.parse_args()

    if not (args.phone or args.email or args.cpf):
        p.error("informe --phone, --email e/ou --cpf")

    evo = EvoClient()

    # Quem já tem CPF preenchido normalmente é CLIENTE (aluna), não "prospect".
    # A busca de prospects não enxerga clientes — então olhamos /members também.
    _diag_clientes(evo, args)
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
