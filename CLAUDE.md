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
| Skills e hooks do Claude | `.claude/skills/` (`subir-versao`, `conferir-pr`, `conferir-celular`, `nova-tela`), `.claude/hooks/` ligados em `.claude/settings.json` (DEP-07) |
| Comandos do servidor | `scripts/atualizar.js` (`slimfit-atualizar`), `scripts/sofia.js` (`slimfit-sofia`) |
| Demonstração | `PAINEL_DEMO=1`: `demo-guard.js`, `demo-dados.js`, `demo-conversas.js` |
| Testes | `Experimental/testes/` (unidade e telas), `agendamento_evo/tests/` |
| Regra → código → teste | `docs/rastreabilidade.md` (matriz e Achados); `npm run matriz`, `npm run testar-alteracao` (em `Experimental/`) |

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
| `.claude/rules/visual.md` — padrão visual e peças de tela | VIS |
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
- **Regra de negócio**: não mudar sem perguntar. Achou erro? Registrar em "Achados" de `docs/rastreabilidade.md` e mostrar ao dono.
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
3. Regra nova/alterada → teste com o código no nome + linha na matriz (`docs/rastreabilidade.md`, depois `npm run matriz`); tela nova → `TELAS` de `testes/tela/telas.js`. `npm run testar-alteracao` roda primeiro os testes das regras mexidas.
4. Mudança que o dono vai notar → **Novidades** em `implantacao.html` (DEP-05).
5. Commit na branch de trabalho → PR → **esperar o CI ✓** → squash merge → sincronizar a branch (skill `subir-versao`, DEP-01). Atualizar servidor só depois da marca `estavel` andar (DEP-02).
6. Regra nova que não cabe nas existentes → no arquivo da área em `.claude/rules/`, com código. Histórico ("por que quebrou") vai no commit, não na regra.

## Pendências combinadas
Plano de organização em fases, um PR por fase, plano mostrado antes de cada uma:
- [x] Fase 0 — diagnóstico · [x] limpeza (PR #433) · [x] Fase 1 — instruções (PR #434)
- [x] Fase 2 — padrão visual (PR #435) — a revisão de design decide as telas fora do padrão listadas no `visual.md`
- [x] Fase 3 — testes (PR #436) · [x] Fase 4 — matriz de rastreabilidade (`docs/rastreabilidade.md`)
- [x] Fase 5 — skills e hooks (DEP-07, TST-10)
- [x] Fase 6 — GitHub: resumo das regras no CI, rodada noturna, botão "Prints das telas" (DEP-08)
- [ ] **Fase 7** — revisão de design (`docs/revisao-de-design.md`), com o Impeccable (ler o código antes de instalar; nosso `visual.md` e as decisões do dono mandam); no fim, prints de referência

Outras:
- A versão **reserva** do WhatsApp Web (SOF-04) vale até **23/01/2027**: antes disso, biblioteca corrigida ou reserva trocada.
- Lago Sul 1 e 2 têm `WA_WEB_VERSION_URL` no `.env` da SoFIA (fixado à mão em 23/11/2026).
- PDFs de `docs/` estão desatualizados (gerar de novo a partir dos `.md`).
- O histórico do Git **não** foi reescrito: os dados do Instagram e o log antigo do agendamento seguem nas versões antigas.

## Achados
Ficam em `docs/rastreabilidade.md` (seção "Achados"), junto com as regras sem teste.
