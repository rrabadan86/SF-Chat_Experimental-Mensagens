"""Confere se os CPFs enviados pelo formulário são VÁLIDOS (dígitos verificadores).

Hipótese: o EVO ignora silenciosamente CPF inválido — por isso o campo chega
vazio no cadastro mesmo o formulário tendo enviado. O formulário hoje só exige
11 dígitos, então um número inventado passa.

Lê a fila de confirmações (onde cada agendamento do formulário grava
"contactId": "form-<cpf>") e valida cada CPF. Só leitura.

Uso (no VPS):
    cd ~/SF-Chat_Experimental-Mensagens/Experimental/src/agendamento_evo
    .venv/bin/python diag_cpf.py
    .venv/bin/python diag_cpf.py 01621529142      # testa um CPF avulso
"""
import json
import os
import sys


def cpf_valido(cpf: str) -> bool:
    """Validação oficial (dígitos verificadores)."""
    c = "".join(ch for ch in str(cpf or "") if ch.isdigit())
    if len(c) != 11 or c == c[0] * 11:
        return False
    for tam in (9, 10):
        soma = sum(int(c[i]) * ((tam + 1) - i) for i in range(tam))
        dv = (soma * 10) % 11
        if dv == 10:
            dv = 0
        if dv != int(c[tam]):
            return False
    return True


def main():
    if len(sys.argv) > 1:
        for cpf in sys.argv[1:]:
            print(f"{cpf}: {'✅ VÁLIDO' if cpf_valido(cpf) else '❌ INVÁLIDO'}")
        return

    arq = os.getenv("STUDIO_OUTBOX_FILE") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "confirmacoes_outbox.jsonl")
    if not os.path.exists(arq):
        print(f"Fila não encontrada: {arq}")
        print("Rode com o CPF direto:  .venv/bin/python diag_cpf.py <cpf>")
        return

    vistos, invalidos = [], 0
    with open(arq, encoding="utf-8") as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha:
                continue
            try:
                row = json.loads(linha)
            except ValueError:
                continue
            cid = str(row.get("contactId") or "")
            if not cid.startswith("form-"):
                continue          # só os que vieram do formulário web
            cpf = cid[5:]
            ok = cpf_valido(cpf)
            invalidos += 0 if ok else 1
            vistos.append((row.get("name"), cpf, ok))

    if not vistos:
        print("Nenhum agendamento vindo do formulário nesta fila ainda.")
        return

    print(f"\n{len(vistos)} agendamento(s) do formulário:\n")
    for nome, cpf, ok in vistos[-20:]:
        mascara = cpf[:3] + ".***.***-" + cpf[-2:] if len(cpf) == 11 else cpf
        print(f"  {'✅' if ok else '❌'} {nome or '(sem nome)':35s} CPF {mascara} "
              f"{'válido' if ok else 'INVÁLIDO → o EVO descarta'}")

    print()
    if invalidos:
        print(f"→ {invalidos} CPF(s) INVÁLIDO(s). É por isso que o campo fica vazio no EVO:")
        print("  o formulário só exige 11 dígitos, e o EVO ignora CPF que não passa na validação.")
    else:
        print("→ Todos os CPFs são válidos. Então a causa é outra — me avise.")


if __name__ == "__main__":
    main()
