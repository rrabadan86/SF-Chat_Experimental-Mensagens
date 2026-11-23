# Revisão de design — passo a passo

Objetivo: olhar **cada tela** do painel no celular e no computador, decidir o que fica e o
que muda, e só então guardar os **prints de referência** (a partir daí, todo PR é comparado
com eles). As regras do padrão visual estão em `.claude/rules/visual.md` (VIS-01 a VIS-07).

Tempo: cerca de 1 h 30 para as 29 telas (uns 3 minutos por tela) — bem menos se você
usar a lista pronta do Impeccable (abaixo) e só concordar, discordar ou acrescentar.

## Impeccable (Fase 7 — ajuda na revisão e nas correções)

O [Impeccable](https://github.com/pbakaus/impeccable) é um pacote de skills de design para o
Claude Code (código aberto). Como ele entra:

1. **Instalação** (no começo da Fase 7, por PR): o Claude lê o código dele antes (é de
   terceiros), instala numa versão fixa dentro do repositório e aponta para o nosso padrão
   (`.claude/rules/visual.md`).
2. **Lista pronta**: o Claude roda o `critique` (hierarquia, clareza, impressão) e o `audit`
   (acessibilidade, celular, desempenho) nas 29 telas e entrega a lista por tela já no
   formato do Passo 5 (👍 / ✏️ / 🔁). Você usa os Passos 2 e 3 para conferir essa lista.
3. **Correções**: um PR por grupo de telas, com o `polish` no acabamento e antes/depois.
4. **Quem decide**: você. Quando o Impeccable sugerir algo contra o nosso padrão ou contra
   uma decisão sua (ex.: ⓘ em toda coluna, tabela que vira cartão no celular), vale o nosso —
   o Claude mostra a divergência e não aplica sozinho.

**Instalado**: skill 4.10.0 (motor 0.1.27, conferido por SHA-256), Apache-2.0, em
`.claude/skills/impeccable/` e `.claude/agents/`. O produto está em `PRODUCT.md`.
O envio de uso está desligado (`.impeccable/config.json`). **Não fazer** `impeccable login`:
com login, os relatórios de critique/audit e o DESIGN.md sobem para a conta do Impeccable.

## Passo 1 — Pegar os prints

Escolha um dos dois jeitos:

**A. Pelo GitHub (recomendado — todas as telas de uma vez, com dados fictícios)**
1. Abra o repositório no GitHub → aba **Actions** → à esquerda, **Prints das telas**.
2. Clique em **Run workflow** → deixe os campos como estão → **Run workflow**.
3. Espere uns 5 minutos até ficar ✓ verde. Clique na rodada → no fim da página, em
   **Artifacts**, baixe o **prints-telas** (um .zip).
4. Abra o zip: cada tela tem `computador-…png` e `celular-…png`.

**B. Pela demonstração**: abra o endereço da demonstração no celular e no computador e
vá passando pelas telas da lista abaixo.

## Passo 2 — Olhar cada tela com estas 7 perguntas

Para cada tela, no celular **e** no computador:

| # | Pergunta | Regra |
|---|---|---|
| 1 | Bate o olho e entende **para que serve** a tela? O que pede atenção está no topo? | VIS-01 |
| 2 | Algo **sai da tela** ou precisa arrastar para o lado? | VIS-02 |
| 3 | Lista comprida tem **busca** e **páginas**? No celular vira cartão legível? | VIS-03 |
| 4 | Todo número e coluna tem o **ⓘ** explicando o que é e como é contado? | VIS-04 |
| 5 | As **cores** fazem sentido (verde = bom, amarelo = atenção, vermelho = problema)? | VIS-05 |
| 6 | Se der erro ao salvar, aparece uma **janela clara** dizendo o que corrigir? | VIS-06 |
| 7 | Os **botões** são fáceis de tocar no celular? Algum texto pequeno demais? | VIS-07 |

Dê uma nota rápida: **👍 ok** · **✏️ ajustar** (diga o quê) · **🔁 refazer** (diga por quê).

## Passo 3 — As telas (marque conforme for olhando)

Comece pelas que a equipe mais usa.

**Dia a dia**
- [ ] `/hoje` — Hoje
- [ ] `/sofia?view=conversas` — Conversas da SoFIA
- [ ] `/sofia?view=contatos` — Contatos
- [ ] `/funil` — Funil
- [ ] `/grade` — Grade de aulas

**Indicadores**
- [ ] `/indicadores` — Indicadores
- [ ] `/metas` — Metas do mês
- [ ] `/professoras` — Professoras
- [ ] `/ativas` — Alunas ativas
- [ ] `/dicionario` — Dicionário de indicadores

**SoFIA e WhatsApp (configuração)**
- [ ] `/sofia?view=config` — Configuração da SoFIA
- [ ] `/sofia?view=tags` — Tags
- [ ] `/sofia?view=campanhas` — Campanhas
- [ ] `/sofia?view=cobranca` — Cobrança
- [ ] `/sofia?view=custo` — Custo da IA
- [ ] `/?view=config` — Configuração do WhatsApp do Studio
- [ ] `/?view=express` — Agendamento express
- [ ] `/visao-cliente` — Visão da cliente

**Slim Club**
- [ ] `/clube?view=pendentes` — Pendentes
- [ ] `/clube?view=aprovados` — Aprovados
- [ ] `/clube?view=reclamacoes` — Reclamações
- [ ] `/clube?view=config` — Configuração

**Administração**
- [ ] `/formularios` — Formulários
- [ ] `/saude` — Saúde do sistema
- [ ] `/perfis` — Perfis
- [ ] `/perfis?view=acessos` — Acessos
- [ ] `/perfis?view=auditoria` — Auditoria
- [ ] `/perfis?view=unidades` — Unidades
- [ ] `/notificacoes` — Notificações

Fora do painel (abrem para o público, olhe no celular): formulário da aula experimental e o
cadastro do Slim Club.

## Passo 4 — Decidir as pendências já conhecidas

Estas já estão listadas no `visual.md`. Diga, para cada uma: **corrigir agora**, **depois** ou **deixar como está**.

1. **Dois lugares que ainda podem rolar para o lado** com muitos dados: o mapa de calor e as respostas dos Formulários. Com os dados da demonstração eles não rolam.
2. **Cores escritas à mão** (cerca de 105), sobretudo na SoFIA. O efeito: a cor pode ficar diferente do resto do painel.
3. **Avisos de erro em janelinha do navegador** (`alert`, cerca de 80), sobretudo na SoFIA. O padrão é a janela do painel, que marca o campo errado.
4. **Listas longas sem busca nem páginas:** pessoas no Funil e em Professoras, Log, Auditoria e Campanhas.

## Passo 5 — Me passar o resultado

Mande no chat, do jeito mais fácil para você: texto, áudio transcrito ou prints com rabisco.
Um formato que ajuda:

```
/metas (celular) ✏️ os 4 quadros do topo ficam apertados; prefiro 2 por linha
/funil 🔁 a lista de pessoas é longa demais; quero busca e só as 20 primeiras
Pendência 3 (alert): corrigir agora
```

## Passo 6 — O que eu faço depois

1. Junto os seus pedidos com a lista do Impeccable e mostro o **plano** antes de começar.
2. Faço um PR por grupo de telas, com **antes e depois** (celular e computador) para você aprovar.
3. Quando todas as telas estiverem 👍, guardamos os **prints de referência**. Daí em diante, todo PR que mexer em tela é comparado com eles, e o que mudou sem querer aparece na hora.
