#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verifica se a correção do RESUMO do ZEE está funcionando.

O bug (já corrigido pela equipe do ZEE): o /summary ignorava o threadId e
devolvia sempre o resumo da PRIMEIRA conversa (a mais antiga). Este script
mostra, lado a lado, o resumo de cada thread do contato — assim você confirma
que, passando o threadId da conversa MAIS RECENTE, vem o resumo certo (o de
agora), e não mais o antigo (ex.: o de junho da Geslaine).

COMO USAR (dentro da pasta agendamento_evo, onde está o .env):
    python verificar_resumo.py --phone 5562999998888
    python verificar_resumo.py --contact <contactId>

Ele lê ZEE_BASE_URL / ZEE_TOKEN / ZEE_AUTH_HEADER do seu .env automaticamente.
"""
import argparse
import os
import sys
from datetime import datetime

import requests


# ---------- carrega variáveis do .env (parser simples, sem dependências) ----------
def carregar_env(caminho=".env"):
    if not os.path.exists(caminho):
        return
    with open(caminho, "r", encoding="utf-8") as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            chave = chave.strip()
            valor = valor.strip().strip('"').strip("'")
            os.environ.setdefault(chave, valor)


def cfg(nome, padrao=""):
    v = os.getenv(nome, padrao)
    return v.strip() if isinstance(v, str) else v


class Zee:
    def __init__(self):
        self.base = cfg("ZEE_BASE_URL", "https://magic.zee.tech/api/v1").rstrip("/")
        token = cfg("ZEE_TOKEN")
        if not token:
            sys.exit("❌ ZEE_TOKEN não encontrado no .env (nem no ambiente).")
        header = cfg("ZEE_AUTH_HEADER", "z-api-key")
        scheme = cfg("ZEE_AUTH_SCHEME", "")
        valor = f"{scheme} {token}".strip() if scheme else token
        self.headers = {header: valor, "Accept": "application/json"}

    def get(self, path, params=None):
        r = requests.get(f"{self.base}{path}", params=params, headers=self.headers, timeout=30)
        if not r.ok:
            raise RuntimeError(f"ZEE GET {path} -> HTTP {r.status_code}: {(r.text or '')[:300]}")
        try:
            return r.json()
        except ValueError:
            return r.text

    def contato(self, phone=None, contact_id=None):
        params = {}
        if phone:
            params["phone"] = phone
        if contact_id:
            params["contactId"] = contact_id
        return self.get("/contact", params=params)

    def threads(self, contact_id, max_paginas=6):
        """Junta as threads do contato paginando a partir da página 0 (as mais novas)."""
        vistos, todos = set(), []
        for page in range(0, max_paginas):
            lote = self.get("/threads", params={"contactId": contact_id, "page": page}) or []
            if not isinstance(lote, list) or not lote:
                break
            novos = 0
            for t in lote:
                tid = t.get("id")
                if tid and tid not in vistos:
                    vistos.add(tid)
                    # garante que é do contato pedido
                    if not t.get("contactId") or t.get("contactId") == contact_id:
                        todos.append(t)
                        novos += 1
            if novos == 0:
                break
        return todos

    def resumo(self, contact_id, thread_id=None):
        params = {"threadId": thread_id} if thread_id else None
        data = self.get(f"/summary/{contact_id}", params=params) or {}
        return data.get("summary") if isinstance(data, dict) else data


def quando(iso):
    if not iso:
        return "(sem data)"
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M UTC")
    except Exception:
        return str(iso)


def main():
    ap = argparse.ArgumentParser(description="Verifica o resumo do ZEE por thread.")
    ap.add_argument("--phone", help="telefone (ex.: 5562999998888)")
    ap.add_argument("--contact", help="contactId direto")
    args = ap.parse_args()
    if not args.phone and not args.contact:
        ap.error("informe --phone ou --contact")

    carregar_env(".env")
    zee = Zee()

    contact_id = args.contact
    if not contact_id:
        c = zee.contato(phone=args.phone) or {}
        contact_id = c.get("id") or c.get("contactId")
        nome = c.get("displayName") or c.get("name") or ""
        if not contact_id:
            sys.exit(f"❌ Não encontrei contactId para o telefone {args.phone}. Resposta: {c}")
        print(f"👤 Contato: {nome}  (contactId={contact_id})")
    else:
        print(f"👤 contactId={contact_id}")

    threads = zee.threads(contact_id)
    if not threads:
        sys.exit("❌ Nenhuma thread encontrada para esse contato.")

    # ordena da MAIS RECENTE para a mais antiga
    threads.sort(key=lambda t: str(t.get("startDate") or ""), reverse=True)

    print(f"\n🧵 {len(threads)} conversa(s) encontradas (da mais recente para a mais antiga):\n")
    print("=" * 70)
    for i, t in enumerate(threads):
        tid = t.get("id")
        marca = "  ← MAIS RECENTE" if i == 0 else ("  ← mais antiga" if i == len(threads) - 1 else "")
        print(f"\n[{i+1}] thread {tid}")
        print(f"    início: {quando(t.get('startDate'))}{marca}")
        print(f"    status: {t.get('status')}")
        try:
            resumo = zee.resumo(contact_id, thread_id=tid)
        except Exception as e:
            resumo = f"(erro ao buscar resumo: {e})"
        print(f"    RESUMO: {resumo}")
    print("\n" + "=" * 70)

    # resumo SEM threadId (comportamento padrão do /summary)
    try:
        sem = zee.resumo(contact_id)
    except Exception as e:
        sem = f"(erro: {e})"
    print(f"\n📄 Resumo SEM threadId (padrão do endpoint):\n    {sem}")

    print(
        "\n✅ Se o RESUMO da conversa [1] (MAIS RECENTE) corresponde ao último\n"
        "   atendimento (e é DIFERENTE do da mais antiga), a correção do ZEE está OK.\n"
        "   O bot passa justamente o threadId da conversa mais recente."
    )


if __name__ == "__main__":
    main()
