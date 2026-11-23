---
paths:
  - "Experimental/src/demo-*.js"
  - "scripts/instalar-demo.sh"
---

# Demonstração (`PAINEL_DEMO=1`)

Painel de mostruário com dados fictícios, instalado à parte no servidor do Bueno.

- **DEM-01** Nada sai para a rede e nenhuma ação executa: todo POST é recusado (`demoBloqueado`), comandos e rede são bloqueados em `demo-guard.js`.
- **DEM-02** A pasta da SoFIA da demonstração fica **dentro da própria instalação**; nunca aponta para a SoFIA de uma unidade real.
- **DEM-03** Os dados vêm de `demo-dados.js` e `demo-conversas.js` (fictícios). Conversas reais anonimizadas (`demo-conversas-reais*.json`) ficam só no servidor.
- **DEM-04** O teste de telas (`testes/tela/telas.js`) roda sobre a demonstração — tela nova precisa abrir nela sem erro.
