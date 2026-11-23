---
paths:
  - "Experimental/testes/**"
  - "Experimental/src/agendamento_evo/tests/**"
  - "docs/REGRAS-DE-ENVIO.md"
---

# Testes

Comandos (todos rodam em cópia temporária):
- Unidade: `cd Experimental && node --test testes/unidade/*.test.js`
- Telas: `cd Experimental && node testes/tela/telas.js --estrito` (demonstração, computador e celular)
- Peças de tela no navegador: `cd Experimental && node --test testes/tela/componentes.test.js` (precisa do playwright)
- EVO: `cd Experimental/src/agendamento_evo && python3 -m tests.test_offline`

- **TST-01** Teste nunca toca dado real: use `ambienteIsolado()` de `testes/ajuda.js` (copia o código para uma pasta temporária; `amb.req`, `amb.gravarData`, `amb.gravarSofia`, `amb.whatsappFalso()`); painel em teste roda com `testes/bloqueios.js` (sem rede externa nem comandos).
- **TST-02** Regra nova ou alterada → teste com o nome dizendo a regra em português, e linha no mapa `docs/REGRAS-DE-ENVIO.md` (se for de envio). `matriz-regras.test.js` falha se o mapa citar teste que não existe.
- **TST-03** Tela nova → entra em `TELAS` de `testes/tela/telas.js`.
- **TST-04** Teste que sobe servidor pede a porta a `portaLivre()` de `testes/ajuda.js`: faixa própria 41000–41999 (longe das portas que o navegador e o fetch recusam), conferida livre.
- **TST-05** Teste instável: achar e corrigir a causa; nunca repetir a rodada até passar nem desligar o teste.
- **TST-06** Bateria completa antes de cada PR, e o CI do GitHub (`.github/workflows/ci.yml`) precisa ficar ✓.
- **TST-07** "Hoje" e "agora" vêm de `src/relogio.js` (fonte única; não crie outro `hojeSP`). Teste de data fixa o relógio com `NODE_ENV=test` + `SF_AGORA` (ISO); fora de teste o `SF_AGORA` é ignorado. Datas difíceis em `datas.test.js`: 1º do mês, fim de fevereiro/ano bissexto, 1º de janeiro, domingo, virada do dia em Brasília.
- **TST-08** Perfis: `permissoes.test.js` (todas as rotas, usuário sem acesso) e `perfis.test.js` (cada perfil: o que vê no menu, o que abre, o que o servidor nega). Permissão ou perfil novo → linha em `PERFIS` de `perfis.test.js`.
- **TST-09** Telas (`telas.js`): computador 1366 px e celular 390 px; abre as seções recolhidas; reprova erro de JavaScript, "undefined/null/NaN", rolagem lateral da página **e dentro** de cartão/tabela/bloco (texto com "…" não conta). Peças no navegador: `tela/componentes.test.js`. Clique só em elemento à vista (o Playwright recusa escondido; nos testes próprios, `clicar()` confere que está na tela).
