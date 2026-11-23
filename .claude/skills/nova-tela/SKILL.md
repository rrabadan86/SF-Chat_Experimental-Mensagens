---
name: nova-tela
description: Passo a passo para criar uma tela (ou rota) nova no painel do SlimFit — permissão conferida no servidor, peças do padrão visual, demonstração, teste de perfis e teste de telas. Use sempre que for acrescentar uma tela, aba, sub-aba ou rota ao painel.
---

# Nova tela no painel (SlimFit)

Antes: leia `.claude/rules/painel.md` e `.claude/rules/visual.md`.

1. **Rota e permissão no servidor** (PAI-01, PAI-02)
   - A rota fica em `Experimental/src/painel-mensagens.js`. Pública só se o dono pedir — e aí antes de `const sess = usuarioDaReq(req)`.
   - Regra de acesso em `telaDaUrl` (e, nas abas SoFIA/WhatsApp, em `sofiaRotaPermitida` / `msgRotaPermitida`). Esconder o botão **não** basta.
   - Permissão nova → chave em `TELAS` de `Experimental/src/usuarios.js` (PAI-04). Só admin → PAI-03.
   - Ação que grava → `auditoria.registrar(usuario, acao, alvo, detalhe)` (PAI-06); POST na demonstração é recusado por `demoBloqueado` (PAI-10).

2. **HTML com as peças** (PAI-07, PAI-08, VIS)
   - Página inteira com `chrome(tit, aba, corpo)`; topo com `uiTopo`; filtros com `uiChips`/`uiDatas`; lista longa com `uiTabela` (busca, ordenação, páginas, cartão no celular); ⓘ com `infoI` ou `info` da coluna.
   - Todo texto que vem de fora passa por `esc()`. Cor só por classe/token. Erro ao salvar: `{ ok:false, erro, campo }` → `sfSalvou(j, form)` (VIS-06).
   - Regra de negócio fora do HTML (num módulo próprio), para dar para testar sem abrir a tela.

3. **Demonstração** (DEM-03, DEM-04): a tela precisa abrir com os dados de `demo-dados.js`. Se ela lê um arquivo novo de `data/`, gere um exemplo fictício lá.

4. **Testes**
   - `TELAS` de `Experimental/testes/tela/telas.js` ganha a rota (TST-03).
   - `PERFIS` de `Experimental/testes/unidade/perfis.test.js`: quem abre e quem é negado na rota nova (TST-08). `permissoes.test.js` reprova rota sem regra.
   - Regra nova → teste com o código no nome + linha em `docs/rastreabilidade.md` + `npm run matriz` (TST-02).

5. **Conferir**: skill `conferir-celular` (390 px e 1366 px, prints) e `cd Experimental && npm run testar-alteracao`.

6. **Novidades** em `implantacao.html` (DEP-05) e o manual (`manual.html`) se a equipe for usar a tela.

7. **Subir**: skill `subir-versao` (ela chama a `conferir-pr`).
