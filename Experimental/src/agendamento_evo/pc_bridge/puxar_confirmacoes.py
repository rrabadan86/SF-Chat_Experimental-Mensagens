"""Ponte PC <- Nuvem (Opção A: confirmação sai pelo WhatsApp do Studio).

Roda NO PC do Studio. Puxa as confirmações que o formulário (na nuvem) enfileirou
e grava no MESMO arquivo que o bot Node já envia: confirmacoes_outbox.jsonl. Assim
a aluna do formulário recebe a confirmação pelo número do Studio (8550-8065).

IMPORTANTE (correção 25/07/2026): agora roda em LOOP, puxando a cada 60s.
Motivo: o Render free APAGA a fila da nuvem a cada reinício (~15 min ocioso). Se a
bridge puxasse só de tempos em tempos, uma marcação feita pouco antes do reinício
era perdida (foi o que aconteceu). Puxando a cada 60s: (1) a confirmação é trazida
em ~1 min, antes do reinício; e (2) as requisições frequentes MANTÊM o Render
acordado, então o arquivo não chega a ser apagado.

Como rodar: deixe este script rodando de forma CONTÍNUA (uma vez, no início do
Windows) — NÃO precisa mais agendar no Agendador de Tarefas a cada X minutos.

Configuração (variáveis de ambiente OU edite os padrões abaixo):
  FORM_CLOUD_URL          = https://SEU-APP.onrender.com
  FORM_OUTBOX_TOKEN       = <mesmo token configurado no Render>
  STUDIO_OUTBOX_FILE      = C:\\AntiGravity\\Experimental\\src\\agendamento_evo\\confirmacoes_outbox.jsonl
  FORM_PULL_LOOP_SECONDS  = 60   (0 = roda só uma vez, comportamento antigo)
"""
import json
import os
import time

import requests

CLOUD_URL = os.getenv("FORM_CLOUD_URL", "https://SEU-APP.onrender.com").rstrip("/")
TOKEN = os.getenv("FORM_OUTBOX_TOKEN", "")
LOCAL_OUTBOX = os.getenv(
    "STUDIO_OUTBOX_FILE",
    r"C:\AntiGravity\Experimental\src\agendamento_evo\confirmacoes_outbox.jsonl",
)
# guarda o que já foi puxado (não regrava se o ack falhar num ciclo):
STATE_FILE = os.getenv("FORM_PULL_STATE", os.path.join(os.path.dirname(LOCAL_OUTBOX) or ".", "web_puxados.json"))
# intervalo do loop em segundos (0 = execução única, como antes)
LOOP_SECONDS = int(os.getenv("FORM_PULL_LOOP_SECONDS", "60"))


def _key(row):
    return f"{row.get('contactId')}|{row.get('when')}|{row.get('ts')}"


def _load_state():
    try:
        return set(json.load(open(STATE_FILE, encoding="utf-8")))
    except Exception:
        return set()


def _save_state(s):
    try:
        json.dump(sorted(s), open(STATE_FILE, "w", encoding="utf-8"))
    except Exception as e:
        print("aviso: não consegui salvar estado:", e)


def pull_once():
    """Puxa uma vez da nuvem. Retorna o nº de confirmações novas gravadas."""
    if not TOKEN:
        print("Defina FORM_OUTBOX_TOKEN (o mesmo do Render).")
        return 0
    try:
        r = requests.get(f"{CLOUD_URL}/api/outbox/pending", params={"token": TOKEN}, timeout=30)
        r.raise_for_status()
        rows = (r.json() or {}).get("rows", [])
    except Exception as e:
        print("Falha ao puxar da nuvem:", e)
        return 0

    ja = _load_state()
    novas, keys = 0, []
    with open(LOCAL_OUTBOX, "a", encoding="utf-8") as f:
        for row in rows:
            k = _key(row)
            keys.append(k)
            if k in ja:
                continue                       # já gravei antes; só vou confirmar o ack
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            ja.add(k)
            novas += 1
    _save_state(ja)
    if novas:
        print(f"{novas} confirmação(ões) nova(s) gravada(s) na fila local.")

    # confirma o recebimento para a nuvem parar de reenviar
    if keys:
        try:
            requests.post(f"{CLOUD_URL}/api/outbox/ack", params={"token": TOKEN},
                          json={"keys": keys}, timeout=30)
        except Exception as e:
            print("aviso: não consegui confirmar (ack) com a nuvem:", e)
    return novas


def main():
    if LOOP_SECONDS <= 0:
        pull_once()
        return
    print(f"Bridge em LOOP: puxando a cada {LOOP_SECONDS}s. Ctrl+C para parar.")
    while True:
        try:
            pull_once()
        except Exception as e:
            print("erro no ciclo (continuo mesmo assim):", e)
        time.sleep(LOOP_SECONDS)


if __name__ == "__main__":
    main()
