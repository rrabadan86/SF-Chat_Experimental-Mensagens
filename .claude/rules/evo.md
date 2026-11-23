---
paths:
  - "Experimental/src/agendamento_evo/**"
  - "Experimental/src/evo-*.js"
  - "Experimental/src/suspensoes.js"
  - "Experimental/src/free-antecedencia*.js"
  - "Experimental/src/experimentais-hist.js"
  - "Experimental/src/historico-experimentais.js"
  - "ChatBot/rota_book_sofia.py"
---

# EVO e agendamento da aula experimental

Dois caminhos até o EVO: a **API** (Python, `agendamento_evo/evo_agendamento/`) e o
**navegador** (Node/puppeteer, `evo-scraper.js` e os jobs). O formulário público é o
Flask de `agendamento_evo/formulario_web/app.py`.

## O que o robô pode e não pode fazer no EVO
- **EVO-01** Login: na **primeira recusa de senha** o robô para de tentar (o EVO bloqueia o usuário). Volta quando o login é salvo de novo no painel ou depois de **6 h**. Todo login chama `require('./evo-login-estado').conferir()` antes de digitar. (decisão do dono para as 6 h, 23/11/2026)
- **EVO-02** Aniversário: a data vem da coluna **"Data de aniversário"** (dia/mês), nunca da última presença; datas lidas de outro mês param o job e avisam.
- **EVO-03** O robô **nunca** clica em Receber, Confirmar pagamento, Excluir, Cancelar, Estornar ou Baixar. "Enviar cobrança" só gera o link. Exceções combinadas: o bloqueio do app (COB-03, exclui e recria o login do app) e a desmarcação do FREE (AGE-04).
- **EVO-04** A API do EVO aceita ~40 pedidos/min: use o limitador (`evo_ratelimit.py`) e a memória por turma; não multiplique leituras.

## Aula experimental
- **AGE-01** Formulário público: **uma experimental por pessoa** (mesmo e-mail, telefone ou CPF) — bloqueia sem cadastrar nem vender. (decisão do dono, 23/11/2026)
- **AGE-02** Pela SoFIA a AGE-01 **não** se aplica (regra SOF-05). (decisão do dono, 23/11/2026)
- **AGE-03** Limite de experimentais por turma e horário (arquivo `sofia-exp-limite.txt`, editado no painel); vale só para as turmas SlimFit, não o Circuito. (decisão do dono, 23/11/2026)
- **AGE-04** Plano FREE (grupo 2): marca com no máximo **1 dia** de antecedência; o robô desmarca o que foi marcado com 2+ dias e avisa no grupo da equipe. (decisão do dono, 23/11/2026)
- **AGE-05** Turma cheia não é erro de leitura: "lotada" devolve alternativas; soluço do EVO (timeout, limite) não vira "lotada".

## Formulário (Flask)
- **AGE-06** Rotas internas exigem token (`FORM_OUTBOX_TOKEN`, `FORM_SLOTS_TOKEN`, `SOFIA_TOKEN`). Públicas: as páginas, `/api/slots`, `/api/book` e, por ora, `/api/diag-evo` (achado R4 em `CLAUDE.md`).

Teste antes de commit: `cd Experimental/src/agendamento_evo && python3 -m tests.test_offline` (EVO simulado, sem rede).
