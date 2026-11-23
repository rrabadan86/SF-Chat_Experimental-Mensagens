---
paths:
  - "Experimental/src/scheduler.js"
  - "Experimental/src/jobs-*.js"
  - "Experimental/src/wa-client.js"
  - "Experimental/src/whatsapp-sender.js"
  - "Experimental/src/enviar*.js"
  - "Experimental/src/mensagens.js"
  - "Experimental/src/horarios.js"
  - "Experimental/src/confirmacao-*.js"
  - "Experimental/src/follow*.js"
  - "Experimental/src/retomada-*.js"
  - "Experimental/src/renova*.js"
  - "Experimental/src/vence-hoje.js"
  - "Experimental/src/boas-vindas.js"
  - "Experimental/src/sentimos-falta.js"
  - "Experimental/src/ausentes-*.js"
  - "Experimental/src/assinaturas.js"
  - "Experimental/src/saidas-grupos.js"
  - "Experimental/src/inadimplentes*.js"
  - "Experimental/src/bloqueio-app*.js"
  - "Experimental/src/aniversari*.js"
  - "Experimental/src/resumo-*.js"
  - "Experimental/src/presentes-pendentes-grupo.js"
  - "docs/rastreabilidade.md"
---

# Envios a clientes (robô do Studio)

Mensagem para aluna ou lead não tem volta. Estas regras valem para todo job que envia.
Horários abaixo são os **padrões**: o Studio muda dias/horário e liga/desliga cada envio
no painel (`horarios.js`, `jobs-ativos.js`). Regra → código → teste: `docs/rastreabilidade.md`.

## Gerais
- **ENV-01** Anota o envio **na hora** de cada mensagem (não só no fim do job). Nunca manda em dobro.
- **ENV-02** Sem conseguir ler ou confirmar (a conversa, a lista do EVO), **não envia** — avisa.
- **ENV-03** Um job por vez (`runJob` / `esperarVez` em `scheduler.js`).
- **ENV-04** Job que se perdeu (robô reiniciou ou ficou ocupado) roda depois só entre **7h e 21h** e com até **3 h** de atraso. (decisão do dono, 23/11/2026)
- **ENV-05** Job que já tinha começado e foi interrompido **não repete sozinho**: avisa para conferir.
- **ENV-06** Texto vem de `mensagens.js` (editável no painel): variáveis preenchidas; `{nome}` some quando não há nome.
- **ENV-07** Contato é achado pelo telefone com ou sem o 9 (`contatos.js`).
- **ENV-08** Trancada não recebe avisos de ausência nem de vencimento. (decisão do dono, 23/11/2026)

## Confirmação e follow-up da aula experimental
- **CONF-01** Confirmação da aula de hoje 08:30 (seg–sáb) e de amanhã 15:30 (dom–sex). (decisão do dono, 23/11/2026)
- **CONF-02** 2ª mensagem só **1h30+** depois da confirmação, com a aula ainda pela frente, se ela não respondeu nem reagiu e ninguém do Studio escreveu. (decisão do dono, 23/11/2026)
- **CONF-03** Quem continua sem responder entra **uma vez** na lista da equipe.
- **FUP-01** Follow-up pós-aula 10:30 e 16:00 (seg–sáb). (decisão do dono, 23/11/2026)
- **FUP-02** Faltou (no-show) 11:30 (aulas da manhã) e 19:30 (tarde/noite). (decisão do dono, 23/11/2026)
- **FUP-03** Encerramento no **dia seguinte**, só para quem não respondeu, não virou aluna e não agendou de novo — vale o registro de agendamentos, mesmo sem etiqueta. (decisão do dono, 23/11/2026)
- **RET-01** Retomada pelo número do Studio: última mensagem da pessoa há **24h+** e dentro de N dias (painel); fica de fora quem agendou nos últimos **30 dias**, virou aluna, tem "sem interesse", está bloqueada ou já falou com o Studio. (decisão do dono, 23/11/2026)

## Alunas e contratos
- **ALU-01** Renovação: avisa quem vence em exatos **7 dias** (painel / `RENOVACAO_DIAS_ANTES`). (decisão do dono, 23/11/2026)
- **ALU-02** "Vence hoje": só contrato SlimFit (Circuito e VIP fora), uma vez por contrato; mais de **60** de uma vez = leitura suspeita → não envia e avisa. (decisão do dono, 23/11/2026)
- **ALU-03** Boas-vindas para contrato que começou nos últimos **3 dias**, separando nova, retorno e renovação. (decisão do dono, 23/11/2026)
- **ALU-04** Indicação aos **30 dias** do início do período, se ainda ativa. (decisão do dono, 23/11/2026)
- **ALU-05** "Sentimos sua falta" toda segunda: 1ª com **14** dias sem presença, 2ª **10** dias depois; depois nada até ela voltar. (decisão do dono, 23/11/2026)
- **ALU-06** Lista de ausentes da equipe com **10** dias sem presença (`AUSENTES_DIAS`). (decisão do dono, 23/11/2026)
- **ALU-07** Contrato sem assinatura: seg, qua e sex, no máximo uma vez por dia; "Não enviar" do painel vale sempre. (decisão do dono, 23/11/2026)
- **ALU-08** Quem não renovou sai dos grupos (`saidas-grupos.js`). (decisão do dono, 23/11/2026)
- **ALU-09** Aniversário: data pela coluna certa do EVO (regra EVO-02 em `evo.md`); não manda se o celular do cadastro é de outra aluna.

## Cobrança
- **COB-01** No máximo **1 vez por dia** por pessoa; só marca como cobrada com o envio confirmado. O robô nunca recebe nem estorna no EVO (regra EVO-03).
- **COB-02** Boleto vencido há **2+ dias** (painel / `INADIMPLENTES_DIAS`) e aviso no dia do vencimento. (decisão do dono, 23/11/2026)
- **COB-03** Bloqueio do app com pendência há **11+ dias** (ajustável de 3 a 90); ao quitar, o login volta e a SoFIA avisa a regra da senha. (decisão do dono, 23/11/2026)

## Equipe e grupos
- **GRP-01** Resumo da semana "Rodar de novo" vale como o envio do dia e não repete o que já saiu.
- **GRP-02** Circuito: convocatória quarta e lembrete sexta 16:15, só se houver Circuito no sábado. (decisão do dono, 23/11/2026)

Regra nova ou alterada aqui → teste (ver `testes.md`) e linha na matriz `docs/rastreabilidade.md`.
