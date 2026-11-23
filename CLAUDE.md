# SlimFit — painel, robô do Studio e SoFIA

Sistema das franquias SlimFit (estúdio de treino feminino). Cada unidade tem o seu servidor
com: **painel** web da equipe, **robô** que manda as mensagens do Studio pelo WhatsApp, **SoFIA**
(IA que atende leads e alunas no WhatsApp próprio) e o **formulário** de aula experimental,
tudo ligado ao **EVO** (sistema de gestão da academia).

O dono escreve em português: **responda em português, em linguagem simples**.

## Organização
| Parte | Onde |
|---|---|
| Painel (Node `http` puro, HTML montado no servidor) | `Experimental/src/painel-*.js`; rotas e permissões em `painel-mensagens.js`; kit comum em `painel-base.js` |
| Robô (jobs agendados, um por vez) | `Experimental/src/scheduler.js` + um arquivo por job; WhatsApp em `wa-client.js` |
| SoFIA | `ChatBot/sofia-listener.ts`, `sofia.ts`, `sofia-engine.ts`; dados em `SOFIA_DIR` |
| EVO e formulário (Python) | `Experimental/src/agendamento_evo/` (API do EVO, Flask, leituras noturnas) |
| Estado de cada servidor | arquivos JSON em `Experimental/data/` e em `SOFIA_DIR` (não há banco) |
| Manuais | `/implantacao` e `/manual` em `agendamento_evo/formulario_web/templates/`; `docs/` |
| Comandos do servidor | `scripts/atualizar.js` (`slimfit-atualizar`), `scripts/sofia.js` (`slimfit-sofia`) |
| Demonstração | `PAINEL_DEMO=1`: `demo-guard.js`, `demo-dados.js`, `demo-conversas.js` |
| Testes | `Experimental/testes/` (unidade e telas), `agendamento_evo/tests/` |

Sistemas de fora: EVO (API e navegador), WhatsApp Web (2 números por loja: robô e SoFIA),
Anthropic (IA), transcrição de áudio, Google (login e planilha), ntfy e push (alertas), GitHub.

## Unidades e servidores
Bueno (`/root/SF-Chat_Experimental-Mensagens`, também hospeda a demonstração), Lago Norte,
Lago Sul 1 e 2 no mesmo servidor (LS2 em `/root/slimfit-lagosul2`), Park Sul, Guará.
O Claude **não** acessa os servidores: passa comandos para o dono rodar.

## Regras por área (carregadas pelo caminho do arquivo)
Cada regra tem um código e fica num lugar só; os outros apontam para ela. "(decisão do dono,
data)" marca regra que é escolha do negócio — **não mude sem perguntar**.

| Arquivo | Códigos |
|---|---|
| `.claude/rules/envio.md` — jobs que mandam mensagem | ENV, CONF, FUP, RET, ALU, COB, GRP |
| `.claude/rules/painel.md` — rotas, perfis, telas | PAI |
| `.claude/rules/sofia.md` — SoFIA | SOF |
| `.claude/rules/evo.md` — EVO e aula experimental | EVO, AGE |
| `.claude/rules/indicadores.md` — números, metas, tags | IND, TAG |
| `.claude/rules/dados-e-segredos.md` — `data/`, `.env`, trava | DAD |
| `.claude/rules/demo.md` — demonstração | DEM |
| `.claude/rules/deploy.md` — PR, CI, servidores | DEP |
| `.claude/rules/testes.md` — como testar | TST |

## Regras que não mudam
- **Segredos e dados pessoais**: nunca escrever, repetir, pedir no chat nem commitar valores do `.env`; nada de `Experimental/data/`, `SOFIA_DIR`, sessões do WhatsApp ou dados reais no Git (DAD-01 a DAD-03).
- **Mensagem a cliente**: anotar o envio na hora, nunca em dobro; sem conseguir ler/confirmar, não envia (ENV-01, ENV-02).
- **Perfis**: conferidos no servidor; rota nova precisa de regra de acesso (PAI-01, PAI-02).
- **Regra de negócio**: não mudar sem perguntar. Achou erro? Registrar em "Achados" abaixo e mostrar ao dono.
- **Demonstração** nunca toca a unidade real (DEM-01, DEM-02).

### Sistemas de fora: o que o Claude pode e não pode
| Sistema | Pode | Não pode |
|---|---|---|
| EVO | ler; agendar experimental; o que está em EVO-03 | receber, estornar, excluir, cancelar; insistir no login depois de recusa (EVO-01) |
| WhatsApp | enviar pelos jobs com as regras de `envio.md` | reiniciar robô/SoFIA em horário de envio; mandar apagar pasta de sessão (use `slimfit-sofia`) |
| IA / transcrição | usar as chaves já salvas | pedir ou mostrar chave |
| GitHub | push na branch de trabalho, PR, merge com CI ✓ | push em outra branch, merge com CI vermelho, reescrever histórico ou criar `backup/...` sem pedido |
| Servidores | passar comandos simples, um por linha | `rm` com variável; comando que o dono não entende |

## Antes de cada commit
1. `node --check` em cada `.js` mexido; SoFIA: `ChatBot/node_modules/.bin/esbuild ChatBot/sofia-listener.ts --format=esm --platform=node --log-level=error > /dev/null`.
2. Bateria (`testes.md`): unidade, telas `--estrito`, EVO offline. Teste em cópia temporária, nunca na `data/` real.
3. Regra nova/alterada → teste + linha no mapa (`docs/REGRAS-DE-ENVIO.md`); tela nova → `TELAS` de `testes/tela/telas.js`.
4. Mudança que o dono vai notar → **Novidades** em `implantacao.html` (DEP-05).
5. Commit na branch de trabalho → PR → **esperar o CI ✓** → squash merge → sincronizar a branch (skill `subir-versao`, DEP-01). Atualizar servidor só depois da marca `estavel` andar (DEP-02).
6. Regra nova que não cabe nas existentes → no arquivo da área em `.claude/rules/`, com código. Histórico ("por que quebrou") vai no commit, não na regra.

## Pendências combinadas
Plano de organização em fases, um PR por fase, plano mostrado antes de cada uma:
- [x] Fase 0 — diagnóstico · [x] limpeza (PR #433) · [ ] **Fase 1 — instruções** (este)
- [ ] Fase 2 — padrão visual (`.claude/rules/visual.md` + peças reutilizáveis)
- [ ] Fase 3 — testes (perfis, datas difíceis com "hoje" fixo, telas com clique e rolagem dentro de cartões)
- [ ] Fase 4 — matriz de rastreabilidade (`docs/rastreabilidade.md`, `npm run matriz`, `npm run testar-alteracao`)
- [ ] Fase 5 — skills (`subir-versao`, `conferir-pr`, `conferir-celular`, `nova-tela`) e hooks
- [ ] Fase 6 — GitHub (rodada noturna, prints de referência — depois da revisão de design)

Outras:
- A versão **reserva** do WhatsApp Web (SOF-04) vale até **23/01/2027**: antes disso, biblioteca corrigida ou reserva trocada.
- Lago Sul 1 e 2 têm `WA_WEB_VERSION_URL` no `.env` da SoFIA (fixado à mão em 23/11/2026).
- PDFs de `docs/` estão desatualizados (gerar de novo a partir dos `.md`).
- O histórico do Git **não** foi reescrito: os dados do Instagram e o log antigo do agendamento seguem nas versões antigas.

## Achados (até a matriz da Fase 4)
- **R3** A trava de segredos só reconhece `NOME=valor` e chaves conhecidas; não pega JSON com chave privada fora de `data/`.
- **R4** Formulário: `/api/diag-evo` é público e devolve o texto do erro; tokens vão na URL e são comparados com `!=`.
- **R5** GET que grava: abrir Metas fecha o mês (IND-06); `GET /logout`.
- **R6** ~47 respostas do painel mostram `e.message` (pode trazer caminho de arquivo ou saída do git).
- **R7** Telefone normalizado de 3 jeitos (`contatos.normTel`, `formularios.normTel`, `agendamentos.normalizarTelefone`) + ~20 "últimos 8 dígitos" soltos.
- **R8** Regras repetidas: horários padrão em `config.js` e `horarios.js`; tolerância de 7 dias no Python e em 5 lugares do JS; identificação de navegador e versão reserva no robô e na SoFIA; dois `patch-wwebjs.js` diferentes.
- **R11** `painel-mensagens.js` e `painel-sofia.js` (~3 mil linhas cada) misturam rota, regra e HTML.
- **R12** IA, transcrição e envio real não têm simulação de teste.
- Faltam testes: confirmação, follow-up, no-show, cobrança, boas-vindas, "vence hoje", campanhas, demonstração (11 linhas "falta teste" em `docs/REGRAS-DE-ENVIO.md`).
