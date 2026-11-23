---
paths:
  - "Experimental/testes/**"
  - "Experimental/src/agendamento_evo/tests/**"
  - "docs/rastreabilidade.md"
  - "scripts/matriz.js"
  - "scripts/testar-alteracao.js"
---

# Testes

Comandos (todos rodam em cópia temporária):
- Unidade: `cd Experimental && npm test` (= `node --test testes/unidade/*.test.js`)
- Só o que a alteração pode ter quebrado primeiro: `cd Experimental && npm run testar-alteracao` (`-- --so` para não rodar o resto)
- Telas: `cd Experimental && node testes/tela/telas.js --estrito` (demonstração, computador e celular); só algumas, com print de todas: `--so=/metas,/funil --prints` (skill `conferir-celular`); relógio parado nos prints: `--relogio=2026-11-23T10:00:00-03:00` (`testes/tela/relogio-fixo.js`)
- Peças de tela no navegador: `cd Experimental && node --test testes/tela/componentes.test.js` (precisa do playwright)
- EVO: `cd Experimental/src/agendamento_evo && python3 -m tests.test_offline`

- **TST-01** Teste nunca toca dado real: use `ambienteIsolado()` de `testes/ajuda.js` (copia o código para uma pasta temporária; `amb.req`, `amb.gravarData`, `amb.gravarSofia`, `amb.whatsappFalso()`); painel em teste roda com `testes/bloqueios.js` (sem rede externa nem comandos).
- **TST-02** Regra nova ou alterada → teste cujo nome **começa pelo código** da regra (ex.: `CONF-02 2ª mensagem: ...`; formas curtas `PAI-01..04`, `VIS-02/03/06`) e linha na matriz `docs/rastreabilidade.md` citando o teste (`` `arquivo.test.js` › começo do título ``). `matriz.test.js` falha se: um código das regras não tem linha; um teste citado não existe (ou o começo do título serve para mais de um); um teste com código no nome não está na linha do código; o resumo está velho (`npm run matriz` reconta).
- **TST-03** Tela nova → entra em `TELAS` de `testes/tela/telas.js`.
- **TST-04** Teste que sobe servidor pede a porta a `portaLivre()` de `testes/ajuda.js`: faixa própria 41000–41999 (longe das portas que o navegador e o fetch recusam), conferida livre.
- **TST-05** Teste instável: achar e corrigir a causa; nunca repetir a rodada até passar nem desligar o teste.
- **TST-06** Bateria completa antes de cada PR, e o CI do GitHub (`.github/workflows/ci.yml`) precisa ficar ✓.
- **TST-07** "Hoje" e "agora" vêm de `src/relogio.js` (fonte única; não crie outro `hojeSP`). Teste de data fixa o relógio com `NODE_ENV=test` + `SF_AGORA` (ISO); fora de teste o `SF_AGORA` é ignorado. Datas difíceis em `datas.test.js`: 1º do mês, fim de fevereiro/ano bissexto, 1º de janeiro, domingo, virada do dia em Brasília.
- **TST-08** Perfis: `permissoes.test.js` (todas as rotas, usuário sem acesso) e `perfis.test.js` (cada perfil: o que vê no menu, o que abre, o que o servidor nega). Permissão ou perfil novo → linha em `PERFIS` de `perfis.test.js`.
- **TST-09** Telas (`telas.js`): computador 1366 px e celular 390 px; abre as seções recolhidas; reprova erro de JavaScript, "undefined/null/NaN", rolagem lateral da página **e dentro** de cartão/tabela/bloco (texto com "…" não conta). Peças no navegador: `tela/componentes.test.js`. Clique só em elemento à vista (o Playwright recusa escondido; nos testes próprios, `clicar()` confere que está na tela).
- **TST-10** Teste que cria pasta temporária usa o prefixo `sf-` e apaga no fim (`finally`). O que sobrar (teste interrompido, prints) o hook `limpar-restos-teste.js` apaga depois de 2 h — só pastas `sf-*` da pasta temporária do sistema.
