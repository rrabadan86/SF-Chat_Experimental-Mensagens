#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI da varredura de antecedência dos planos FREE (GRUPO 2).

Roda a varredura e imprime o RESULTADO em JSON (linha única) no stdout — o robô
(Node) lê esse JSON e, se houve desmarcação, avisa no grupo da Equipe.

  python run_free_antecedencia.py --dry            # NÃO desmarca; só lista
  python run_free_antecedencia.py --dias 3         # janela (padrão 3: hoje+2..+4)
  python run_free_antecedencia.py                  # DESMARCA de verdade

Saída (stdout): um objeto JSON (ver free_antecedencia.varrer). Logs vão p/ stderr.
"""
import argparse
import json
import logging
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=3,
                    help="dias a varrer a partir de hoje+2 (padrão 3 → hoje+2, +3, +4)")
    ap.add_argument("--dry", action="store_true",
                    help="não desmarca — só lista quem seria desmarcada")
    args = ap.parse_args()

    # Logs do pacote vão para stderr; o stdout fica limpo só com o JSON.
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(message)s")

    try:
        from evo_agendamento.free_antecedencia import varrer
    except Exception as e:
        print(json.dumps({"ok": False, "erro": f"import falhou: {e}"}))
        sys.exit(1)

    try:
        res = varrer(dias=args.dias, dry=args.dry)
        res["ok"] = True
        print(json.dumps(res, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "erro": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
