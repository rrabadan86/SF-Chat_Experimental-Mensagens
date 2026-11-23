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
- EVO: `cd Experimental/src/agendamento_evo && python3 -m tests.test_offline`

- **TST-01** Teste nunca toca dado real: use `ambienteIsolado()` de `testes/ajuda.js` (copia o código para uma pasta temporária; `amb.req`, `amb.gravarData`, `amb.gravarSofia`, `amb.whatsappFalso()`); painel em teste roda com `testes/bloqueios.js` (sem rede externa nem comandos).
- **TST-02** Regra nova ou alterada → teste com o nome dizendo a regra em português, e linha no mapa `docs/REGRAS-DE-ENVIO.md` (se for de envio). `matriz-regras.test.js` falha se o mapa citar teste que não existe.
- **TST-03** Tela nova → entra em `TELAS` de `testes/tela/telas.js`.
- **TST-04** Teste que sobe servidor usa porta sorteada (hoje 18000–19999).
- **TST-05** Teste instável: achar e corrigir a causa; nunca repetir a rodada até passar nem desligar o teste.
- **TST-06** Bateria completa antes de cada PR, e o CI do GitHub (`.github/workflows/ci.yml`) precisa ficar ✓.
