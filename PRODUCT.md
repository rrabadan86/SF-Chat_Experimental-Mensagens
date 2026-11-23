# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Equipe das unidades da franquia SlimFit (estúdio de treino feminino). Cada pessoa entra com o
seu perfil e vê só as telas liberadas para ela; o admin vê tudo. O painel é usado no celular e
no computador.

Leads e alunas não usam o painel: falam com a SoFIA e com o Studio pelo WhatsApp e, na web,
usam o formulário da aula experimental e o cadastro do Slim Club.

**Pessoas principais** (decisão do dono, 23/11/2026): o **franqueado** e a **recepcionista**,
que acompanham o painel.

**Em aberto:** qual das duas pesa mais e qual aparelho vem primeiro. Até o dono decidir, atender as duas, no celular e no computador (VIS-07).

## Product Purpose

Cuidar da jornada da aula experimental e das rotinas de relacionamento e gestão de cada
unidade: painel da equipe, robô de mensagens do Studio, SoFIA (IA no WhatsApp próprio) e
formulário de aula experimental, ligados ao EVO (sistema de gestão da academia).

**Em aberto:** a medida de sucesso do painel não foi definida.

## Positioning

Automatiza sem perder o humano: o robô e a SoFIA fazem o repetitivo, e o relacionamento fica
com a recepção. Quando a recepção assume a conversa, a SoFIA pausa naquela conversa (SOF-01).

## Operating Context

- Cada unidade tem a sua instalação e a sua equipe; há dois números de WhatsApp por loja (robô do Studio e SoFIA).
- O EVO é a fonte dos dados de alunas, aulas e vendas.
- Assuntos do painel: dia a dia, indicadores, SoFIA e WhatsApp, Slim Club e administração. Lista das telas: `docs/revisao-de-design.md`.
- Interface e textos em português do Brasil, em linguagem simples.

## Capabilities and Constraints

- Node `http` puro, HTML montado no servidor, sem framework. Peças comuns em `Experimental/src/painel-base.js` e `painel-componentes.js`.
- Rotas, perfis e permissões conferidos no servidor: `.claude/rules/painel.md` (PAI).
- Regra de negócio e "decisão do dono" não mudam sem perguntar (`CLAUDE.md`).
- Dados pessoais e segredos nunca entram no Git nem em prints (`.claude/rules/dados-e-segredos.md`).
- Ideias recusadas ou guardadas ficam em `BACKLOG.md`; não propor de novo como novidade.

## Brand Commitments

- **O padrão visual é `.claude/rules/visual.md` (VIS-01 a VIS-07) e deve ser seguido** (decisão do dono, 23/11/2026). Esse arquivo é a fonte única; se uma sugestão do Impeccable divergir dele ou de uma decisão do dono, vale o nosso: mostrar a divergência e não aplicar sozinho.
- Nomes em uso: SlimFit, SoFIA, Slim Club.

## Evidence on Hand

- Demonstração com dados fictícios (`PAINEL_DEMO=1`): `demo-dados.js` e `demo-conversas.js`. Prints e revisões saem dela (`.claude/rules/demo.md`).
- Passo a passo da revisão e pendências conhecidas: `docs/revisao-de-design.md` e `visual.md`.
- Regra → código → teste: `docs/rastreabilidade.md`.
- Não há depoimentos, resultados ou números de clientes confirmados para divulgação: não inventar.

## Product Principles

1. Automatizar o repetitivo e deixar o relacionamento com a recepção.
2. Na dúvida, não enviar: sem conseguir ler ou confirmar, a mensagem não sai; nunca em dobro (ENV-01, ENV-02).
3. Uma tela, um assunto; o que pede atenção vem primeiro (VIS-01).
4. O acesso é decidido no servidor, nunca só escondendo o botão (PAI-02).

## Accessibility & Inclusion

Toda tela é conferida no celular a 390 px e no computador (VIS-07), e nada rola para o lado
(VIS-02). Nenhum nível formal (ex.: WCAG) foi definido.
