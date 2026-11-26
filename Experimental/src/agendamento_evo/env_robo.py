"""Comandos rodados À MÃO no servidor (push_slots, diags, run_agendamento) leem também
o .env do ROBÔ (Experimental/.env).

Por quê: esta pasta tem o .env do FORMULÁRIO, que o config.py acha primeiro — sem o
endereço/token de envio da grade e com a atividade copiada na instalação. Quando o robô
ou o painel rodam estes scripts, as variáveis do robô já vêm no ambiente; à mão, não
vinham, e o resultado era outro (Sorocaba, 26/11/2026). Aqui só se completa o que ainda
não está no ambiente (setdefault): o que o robô/painel passam continua valendo.
"""
import os

ENV_ROBO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")


def carregar(caminho=ENV_ROBO):
    try:
        with open(caminho, encoding="utf-8") as f:
            for raw in f:
                linha = raw.strip()
                if not linha or linha.startswith("#") or "=" not in linha:
                    continue
                k, v = linha.split("=", 1)
                k, v = k.strip(), v.strip()
                if v[:1] in ('"', "'") and v[-1:] == v[:1]:
                    v = v[1:-1]
                else:
                    v = v.split(" #", 1)[0].rstrip()
                os.environ.setdefault(k, v)
    except OSError:
        pass
