# ═══════════════════════════════════════════════════════════════════════════
#  ROTA NOVA PARA A SOFIA (WhatsApp) — agenda no EVO SEM exigir CPF/nascimento
# ───────────────────────────────────────────────────────────────────────────
#  COMO USAR:
#  1) Cole o BLOCO ABAIXO dentro do seu formulario_web/app.py, logo após as
#     outras rotas (antes do `if __name__ == "__main__":`).
#  2) No topo do app.py você JÁ importa `book_experimental`, `TurmaLotadaError`,
#     `EvoClient` e `only_digits` — então não precisa importar de novo.
#  3) No Render, adicione UMA variável de ambiente nova:
#         SOFIA_TOKEN = (uma senha secreta forte, que só a Sofia vai conhecer)
#     As variáveis do EVO (EVO_DNS, EVO_TOKEN, EVO_SERVICE_ID, etc.) já existem,
#     pois o formulário já agenda — esta rota reaproveita exatamente as mesmas.
#
#  A Sofia (Node) vai chamar:  POST https://SEU-APP.onrender.com/api/book-sofia
#  com header  X-Sofia-Token: <mesma senha>  e corpo JSON:
#     { "nome": "...", "email": "...", "telefone": "...", "when": "quinta-feira às 16:30" }
# ═══════════════════════════════════════════════════════════════════════════

import os
from flask import request, jsonify

SOFIA_TOKEN = os.getenv("SOFIA_TOKEN", "")


@app.post("/api/book-sofia")
def api_book_sofia():
    # 1) Autenticação simples por token compartilhado (só a Sofia conhece).
    if not SOFIA_TOKEN or request.headers.get("X-Sofia-Token") != SOFIA_TOKEN:
        return jsonify({"ok": False, "erro": "não autorizado"}), 401

    dados = request.get_json(silent=True) or {}
    nome = (dados.get("nome") or "").strip()
    email = (dados.get("email") or "").strip().lower()
    telefone = only_digits(dados.get("telefone"))
    when = (dados.get("when") or "").strip()   # "quinta-feira às 16:30" ou "2026-07-30 16:30"

    # 2) Validação mínima (sem CPF/nascimento — fluxo leve do WhatsApp).
    if len(nome.split()) < 2:
        return jsonify({"ok": False, "erro": "nome incompleto"}), 400
    if not email or "@" not in email:
        return jsonify({"ok": False, "erro": "email inválido"}), 400
    if not when:
        return jsonify({"ok": False, "erro": "horário não informado"}), 400

    # 3) Agenda no EVO reusando TODA a sua lógica (cadastro + venda + matrícula,
    #    deduplicação, limite de experimentais, etc.). CPF/nascimento ficam de fora.
    try:
        res = book_experimental(name=nome, when=when, email=email, phone=telefone)
    except TurmaLotadaError as e:
        # Turma cheia / inexistente / fora de janela: o lead JÁ foi cadastrado no EVO.
        # Devolvemos as alternativas para a Sofia oferecer outro horário à aluna.
        return jsonify({
            "ok": False,
            "motivo": "sem_vaga",
            "detalhe": str(e),
            "alternativas": [a.get("when") for a in (e.alternatives or [])][:5],
        }), 409
    except Exception as e:
        app.logger.exception("Sofia: falha no agendamento")
        return jsonify({"ok": False, "erro": f"não consegui agendar: {e}"}), 500

    # 4) Sucesso: a aula foi agendada no EVO.
    return jsonify({
        "ok": True,
        "when": res.when,               # "2026-07-30 16:30" (data real resolvida)
        "idProspect": res.id_prospect,
        "activity": res.activity,
    })
