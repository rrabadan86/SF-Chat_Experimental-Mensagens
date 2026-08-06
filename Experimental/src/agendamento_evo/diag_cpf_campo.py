"""Descobre QUAL nome de campo o EVO aceita para gravar o CPF ao criar prospect.

Contexto: o cadastro devolve o CPF em "document", e enviamos exatamente esse
nome — mas ele não é gravado. Já sabemos que o EVO usa nomes diferentes na
entrada e na saída (enviamos "birthday", ele devolve "birthDate"), então o
nome de ENTRADA do CPF provavelmente é outro.

Este script CRIA cadastros de teste (um por candidato), lê de volta e diz qual
nome funcionou. Os cadastros ficam com o nome "ZZTESTE ..." para você apagar
depois no EVO.

⚠️ ESCREVE no EVO. Só roda com --confirmar.

Uso (no VPS):
    cd ~/SF-Chat_Experimental-Mensagens/Experimental/src/agendamento_evo
    .venv/bin/python diag_cpf_campo.py --confirmar
"""
import argparse
import random
import time

from evo_agendamento import EvoClient
from evo_agendamento.evo_client import _drop_empty

# Nomes candidatos para o CPF na CRIAÇÃO do prospect.
CANDIDATOS = ["document", "cpf", "documentNumber", "numberDocument", "idDocument"]


def gerar_cpf_valido() -> str:
    """Gera um CPF com dígitos verificadores corretos (para o teste)."""
    base = [random.randint(0, 9) for _ in range(9)]
    for tam in (9, 10):
        soma = sum(base[i] * ((tam + 1) - i) for i in range(tam))
        dv = (soma * 10) % 11
        base.append(0 if dv == 10 else dv)
    return "".join(map(str, base))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--confirmar", action="store_true",
                   help="obrigatório: confirma que pode criar cadastros de teste no EVO")
    args = p.parse_args()

    if not args.confirmar:
        print(__doc__)
        print("\n⚠️  Nada foi feito. Rode com --confirmar para executar o teste.")
        return

    evo = EvoClient()
    marca = str(int(time.time()))[-6:]
    vencedores, criados = [], []

    print(f"\nCriando {len(CANDIDATOS)} cadastro(s) de teste (nome começa com ZZTESTE)...\n")

    for campo in CANDIDATOS:
        cpf = gerar_cpf_valido()
        sobrenome = f"{campo}{marca}"
        body = {
            "name": "ZZTESTE",
            "lastName": sobrenome,
            "email": f"zzteste.{campo.lower()}.{marca}@exemplo-teste.com",
            "cellphone": f"6299{random.randint(1000000, 9999999)}",
            "ddi": "55",
            campo: cpf,                      # ← o candidato sob teste
        }
        bid = evo._bid(None)
        if bid:
            body["idBranch"] = bid
        try:
            data = evo._request("POST", "/api/v1/prospects", json=_drop_empty(body))
            idp = (data or {}).get("idProspect")
        except Exception as e:
            print(f"  {campo:16s} → erro ao criar: {e}")
            continue
        if not idp:
            print(f"  {campo:16s} → não retornou idProspect")
            continue
        criados.append((idp, sobrenome))

        # lê de volta e confere se o CPF ficou gravado em "document"
        time.sleep(1.0)
        achados = evo.find_prospects(email=body["email"]) or []
        gravado = (achados[0].get("document") if achados else None)
        ok = "".join(ch for ch in str(gravado or "") if ch.isdigit()) == cpf
        print(f"  {campo:16s} → idProspect={idp}  document={gravado!r}  {'✅ GRAVOU' if ok else '❌ vazio'}")
        if ok:
            vencedores.append(campo)

    print()
    if vencedores:
        print(f"✅ Campo(s) que funcionam para o CPF: {', '.join(vencedores)}")
        print("   → é esse nome que o cadastro deve usar.")
    else:
        print("❌ Nenhum nome funcionou. O EVO provavelmente não aceita CPF ao CRIAR")
        print("   o prospect — nesse caso é preciso gravar o CPF num segundo passo")
        print("   (atualização do cadastro).")

    if criados:
        print("\n🧹 Apague estes cadastros de teste no EVO quando puder:")
        for idp, sob in criados:
            print(f"   • ZZTESTE {sob}  (idProspect={idp})")


if __name__ == "__main__":
    main()
