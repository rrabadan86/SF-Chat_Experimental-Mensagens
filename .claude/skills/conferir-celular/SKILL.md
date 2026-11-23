---
name: conferir-celular
description: Abre as telas do painel que o trabalho mexeu, no celular (390 px) e no computador (1366 px), sobre a demonstração, tira os prints e confere que nada rola para o lado, não há erro de JavaScript nem "undefined". Use sempre que mexer em tela do painel, antes do PR.
---

# Conferir no celular (SlimFit)

Tudo roda na **demonstração** (dados fictícios, numa pasta temporária) — nunca na unidade real (DEM-01, TST-01).

1. **Quais telas**: pelos arquivos mexidos (`git diff --name-only origin/main...HEAD`), ache as rotas em `TELAS` de `Experimental/testes/tela/telas.js` (ex.: `painel-metas.js` → `/metas`; `painel-sofia.js` → `/sofia?view=...`). Tela nova que não está em `TELAS` → acrescente (TST-03) antes de seguir.

2. **Rodar só essas telas, com print de todas**:
   ```
   cd Experimental && SAIDA=<scratchpad>/prints node testes/tela/telas.js --so=/metas,/funil --prints --estrito
   ```
   (sem playwright no caminho: `NODE_PATH=$(npm root -g)` na frente). Use a pasta de rascunho da sessão em `SAIDA`, nunca o repositório.

3. **Ler o relatório**: reprova erro de JavaScript, HTTP 4xx/5xx, tela vazia; avisa "undefined/null/NaN", rolagem lateral da página **e dentro** de cartão/tabela (VIS-02). Com `--estrito`, aviso também reprova. Corrija a causa — nunca `overflow-x:auto` para esconder.

4. **Olhar os prints** (abra os `.png` com a ferramenta de leitura de arquivo): celular-*.png e computador-*.png de cada tela.
   - O que pede atenção vem primeiro (VIS-01); tabela longa com busca e páginas (VIS-03); ⓘ nas colunas e números (VIS-04); cores do padrão, sem `#hex` novo em `style=` (VIS-05); erro ao salvar em janela (VIS-06).
   - No celular: tabela virou cartão, botões dá para tocar, nada cortado.

5. **Mostrar ao dono** os prints mais importantes (antes/depois quando for mudança visual) com uma frase do que mudou.

6. **Bateria completa** antes do PR: `node testes/tela/telas.js --estrito` (todas as telas) e `node --test testes/tela/componentes.test.js`.
