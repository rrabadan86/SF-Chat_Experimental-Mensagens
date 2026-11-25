---
paths:
  - "Experimental/src/painel-indicadores.js"
  - "Experimental/src/painel-metas.js"
  - "Experimental/src/metas.js"
  - "Experimental/src/ativas-dados.js"
  - "Experimental/src/agendou-registro.js"
  - "Experimental/src/indicadores.js"
  - "Experimental/src/dicionario-indicadores.js"
  - "Experimental/src/atendimento.js"
  - "Experimental/src/financeiro-resumo.js"
  - "Experimental/src/comparecimento.js"
  - "Experimental/src/contatos.js"
  - "Experimental/src/painel-automacao.js"
  - "Experimental/src/agendamento_evo/run_ativas_foto.py"
  - "Experimental/src/pagamento/**"
---

# Indicadores, metas e tags do funil

Todo número novo entra no Dicionário (`dicionario-indicadores.js`), com a conta e a fonte.
O resumo no WhatsApp e as telas usam os mesmos módulos (`ativas-dados.js`, `agendou-registro.js`), para os números baterem.

## Alunas ativas
- **IND-01** Ativa = contrato vigente; **trancada conta como ativa**; quem renova até **7 dias** depois do vencimento continua ativa (tolerância). (decisão do dono, 23/11/2026)

## Funil
- **IND-02** Agendamento é anotado **na hora** em `agendou-registro.js` (SoFIA, Formulário, Express), sem depender de etiqueta; o mesmo agendamento visto em vários lugares em até **2 h** conta uma vez.
- **IND-03** Comparecimento = fez ÷ (fez + faltou) — quem ainda vai fazer não entra.
- **IND-04** "Conversaram" = quem escreveu no período. Remarcação conta no período do **primeiro** agendamento.
- **IND-05** Quem tem "Conversas da SoFIA" também vê o Funil (`podeFunil`). (decisão do dono, 23/11/2026)

## Metas e mês
- **IND-06** O mês fecha no **dia 9** do mês seguinte (depois da tolerância de renovação) e a foto não muda mais; só um mês sem funil pode ser completado depois. (decisão do dono, 23/11/2026)
- **IND-07** Inadimplência = em atraso ÷ o que já venceu.

## Tags do funil
- **TAG-01** Entrar numa etapa do funil tira a etapa anterior; a tag que chega fica.
- **TAG-02** Presença semanal (sábado 16h): compareceu → "Fez aula"; faltou → "sem presença"; só mexe em quem está com a tag "Agendou". (decisão do dono, 23/11/2026)

## Pagamento dos professores (só no Bueno; `src/pagamento/`)
- **PAG-01** Sábado: a partir do mês escolhido em Regras ("Sábado por aula a partir de"), **cada aula de sábado paga R$ 35** (valor editável) **a quem deu aquela aula** — duas professoras no mesmo sábado, 35 cada; a mesma nas duas, 70 — inclusive em feriado ou aula vazia. Antes desse mês vale a diária antiga (R$ 70 por sábado para cada professor). (decisão do dono, 25/11/2026)
