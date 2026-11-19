# SlimFit — painel, robô do Studio e SoFIA

Sistema multi-unidade (franquias SlimFit). O dono escreve em português: responda em português, em linguagem simples.

## Organização
- `Experimental/src/painel-*.js` — painel web (Node `http` puro, sem Express). HTML/CSS/JS montados no servidor, inline. Kit comum em `painel-base.js` (`chrome`, `uiTopo`, `infoI`, subnavs). Rotas e checagem de acesso em `painel-mensagens.js` (`telaDaUrl`, `sofiaRotaPermitida`, `msgRotaPermitida`, `negarAcesso`).
- `Experimental/src/scheduler.js` — robô do Studio (jobs agendados, UM job por vez: `runJob`/`esperarVez`). WhatsApp do Studio em `wa-client.js`.
- `ChatBot/sofia-listener.ts`, `sofia.ts` — SoFIA (IA no WhatsApp próprio). Dados em `SOFIA_DIR` (ex.: `/root/sofia-data`).
- `Experimental/src/agendamento_evo/` — automação do EVO e formulário (Python). Páginas `/implantacao` e `/manual` em `formulario_web/templates/`.
- `scripts/` — `atualizar.js` (`slimfit-atualizar`), `sofia.js` (`slimfit-sofia`), `instalar-demo.sh`.
- Demonstração: `PAINEL_DEMO=1` → `demo-guard.js` (bloqueia comandos, rede e ações), `demo-dados.js`, `demo-conversas.js`.

## Unidades e servidores
Bueno (`/root/SF-Chat_Experimental-Mensagens`, pm2 `slimfit-*`, `sofia-listener`), Lago Norte (`lagonorte-*`), Lago Sul 1 e 2 no mesmo servidor (LS2 em `/root/slimfit-lagosul2`, `SOFIA_DIR=/root/sofia-data-lagosul2`), Park Sul, Guará. Nomes do PM2 via `pm2-nomes.js`. Deploy: `slimfit-atualizar` (todas as pastas do servidor) ou painel → Saúde → Atualizar agora — baixam só a marca `estavel`, que o CI move quando a main passa em tudo (`scripts/ramo-estavel.js`).

## Antes de cada commit
- `node --check` em todo `.js` alterado; SoFIA: `ChatBot/node_modules/.bin/esbuild ChatBot/sofia-listener.ts --format=esm --platform=node --log-level=error > /dev/null`.
- Testes (rodam em cópia temporária, nunca nos dados de verdade): `cd Experimental && node --test testes/unidade/*.test.js`; telas: `node testes/tela/telas.js` (demonstração, computador + celular); EVO: `cd Experimental/src/agendamento_evo && python3 -m tests.test_offline`.
- Regra nova de envio/tag → teste em `Experimental/testes/unidade/` (use `ambienteIsolado()` e `whatsappFalso()` de `testes/ajuda.js`) e linha em `docs/REGRAS-DE-ENVIO.md`. Tela nova → incluir em `TELAS` de `testes/tela/telas.js`.
- Teste o que der numa cópia em scratch (nunca na pasta `Experimental/data` do repo). Telas: rode o painel com `PAINEL_DEMO=1` e tire print.
- Mudança que o usuário vai ver/precisa saber → item em **Novidades** de `formulario_web/templates/implantacao.html` (e na seção de Manutenção se for comando).
- Fluxo (skill `subir-versao`): commit na branch de trabalho → PR para `main` → **esperar o CI ✓** (`.github/workflows/ci.yml`) → squash merge → `git fetch origin main && git merge origin/main` → push. CI vermelho: corrigir antes; nunca mesclar por cima.

## Regras que não mudam
- **Segredos**: nunca escrever, repetir ou commitar valores de `.env` (token do EVO, Basic auth, chaves de IA, chave do Fitily, `PAINEL_SENHA`). Não commitar `.env`, `Experimental/data/`, sessões do WhatsApp (`wwebjs_auth`, `.wwebjs_auth`), `sofia-demo/`, `demo-conversas-reais*.json`.
- **Envios a clientes**: todo job que manda mensagem anota o envio NA HORA (não só no fim) — nunca mandar em dobro. Sem conseguir ler/confirmar, não envia.
- **Demonstração** nunca toca a unidade real: pasta da SoFIA só dentro da própria instalação; nada sai para a rede.
- **Permissões** checadas no servidor (rota nova precisa de regra em `telaDaUrl`/`*RotaPermitida`), não só escondidas na tela.
- Reiniciar robô/SoFIA só fora dos horários de envio. Não mandar o usuário apagar pastas de sessão à mão — use `slimfit-sofia`.
- Comandos para o usuário rodar: simples, um por linha, sem `rm` com variável.
