---
paths:
  - "Experimental/src/painel-*.js"
  - "Experimental/src/slimclub-paginas.js"
  - "Experimental/src/formularios-paginas.js"
  - "Experimental/testes/tela/**"
---

# Padrão visual das telas

Princípios (decisão do dono, 23/11/2026):
- **VIS-01** Simples: uma tela, um assunto; o que pede atenção vem primeiro; explicação longa fica atrás de "ⓘ".
- **VIS-02** **Nada rola para o lado** — nem a página nem dentro de cartão ou tabela. Texto longo quebra (`overflow-wrap:anywhere`); no celular a tabela vira cartão. `overflow-x:auto` não é solução.
- **VIS-03** Lista com mais de ~5 itens é **tabela** (`uiTabela`): busca, ordenação, páginas e cartão no celular.
- **VIS-04** **ⓘ** (`infoI` / `info` da coluna) em toda coluna e todo quadro de número, dizendo o que é e como é contado.
- **VIS-05** Cor só por **classe ou token** (`--teal`, `--ok`, `--erro`, `--warn`, `--cinza`, `--linha`…, definidos em `ESTILO` de `painel-base.js`). Nada de `#hex` em `style=`.
- **VIS-06** Erro ao salvar abre **janela** e **marca o campo** (`sfErroSalvar` / `sfSalvou` no navegador; `uiErroSalvar` vindo do servidor) — nunca um aviso discreto nem `alert()`.
- **VIS-07** Toda tela conferida no **celular a 390 px** e no computador antes do PR (print).

## Peças — use antes de inventar outra
| Peça | Onde | Para quê |
|---|---|---|
| `chrome(tit, aba, corpo)` | `painel-base.js` | página inteira: menu, conta, estilos e scripts comuns |
| `uiTopo({titulo, sub, acoes, linhas})` | `painel-base.js` | cartão de topo da tela |
| `uiChips(rotulo, itens)` / `uiDatas(...)` | `painel-base.js` | filtros de período/canal; datas atrás de "📅 Escolher datas" |
| `uiBarra(...)` / `uiTrilho(n, max)` | `painel-base.js` | barras e trilhos de proporção |
| `uiPessoa({...})` | `painel-base.js` | linha de pessoa (Funil, Professoras) |
| `infoI(html)` | `painel-base.js` | o "ⓘ" com explicação |
| `subnav*` | `painel-base.js` e telas | sub-abas |
| `sfRevisar({...})` / `sfConfirmarForm` | `painel-base.js` (navegador) | revisar QUEM vai ser afetado antes de ação em massa |
| `uiTabela({colunas, linhas, ...})` | `painel-componentes.js` | lista padrão (VIS-03) |
| `uiErroSalvar(msg, campo)`, `sfErroSalvar`, `sfSalvou` | `painel-componentes.js` | janela de erro ao salvar (VIS-06) |
| classes `.card`, `.save`, `.reset`, `.ui-btn`, `.sd-pill.sd-ok/warn/erro`, `.quando`, `.vazio` | `ESTILO` | cartão, botões, selos, textos de apoio |

Resposta de salvar por `fetch`: `{ ok:false, erro:'texto para o dono', campo:'nome-do-input' }` → `if (!sfSalvou(j, form)) return;`.

## Telas que ainda não seguem o padrão (para a revisão de design decidir)
- `overflow-x:auto` em tabelas: Indicadores (6), SoFIA (3), WhatsApp (2), base (3), Formulários, Metas, Perfis → Auditoria (VIS-02).
- Cores `#hex` em `style=`: SoFIA (~85), WhatsApp (10), Páginas públicas (4), Perfis (3), base (3) (VIS-05).
- `alert()` para erro: SoFIA (~62), Formulários (8), Slim Club (6), base (4), WhatsApp (1) (VIS-06).
- Listas longas sem busca/páginas no padrão: Funil e Professoras (pessoas), Log, Perfis → Auditoria, Campanhas (VIS-03).
