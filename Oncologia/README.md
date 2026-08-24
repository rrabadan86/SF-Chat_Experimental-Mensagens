# Agendamento de consultas — oncologista

Página do médico + formulário que agenda direto na **agenda do Google do hospital
escolhido** e avisa a **recepcionista pelo WhatsApp**, que confirma respondendo
uma mensagem.

| | |
|---|---|
| [`prototipo.html`](prototipo.html) | Esboço de apresentação. Abre no navegador, tudo simulado, serve para mostrar a ideia ao médico. |
| [`GUIA-AGENDAS-GOOGLE.md`](GUIA-AGENDAS-GOOGLE.md) | Passo a passo para criar e compartilhar as duas agendas. É o que o médico precisa fazer. |
| [`IMPLANTACAO-VPS.md`](IMPLANTACAO-VPS.md) | Passo a passo para colocar no ar numa VPS Ubuntu, com nginx, HTTPS e PM2. |
| [`app/`](app/) | O sistema de verdade: servidor, integração com o Google e com o WhatsApp. |

---

## Como funciona

```
Paciente (celular ou computador)
      │  GET /api/horarios?hospital=h1
      ▼
  Servidor ──► Google Calendar  freebusy nas DUAS agendas + agendas de bloqueio
      │        devolve só o que está realmente livre
      │
      │  POST /api/agendar
      ▼
  Servidor ──► reconsulta o Google (a tela pode estar aberta há meia hora)
      │    ──► events.insert na agenda daquele hospital
      │           título:  "PRÉ · <paciente> — <tipo>"
      │           status:  tentative
      │           extendedProperties.private.protocolo = PA-2026-0000
      │
      └──────► WhatsApp da recepcionista: dados do paciente + protocolo

  Recepcionista liga para o paciente e responde no WhatsApp:
  "CONFIRMAR PA-2026-0000"
      │
      ▼
  Servidor ──► acha o evento pelo protocolo
      │    ──► events.patch  status: confirmed, tira o "PRÉ ·" do título
      └──────► avisa o paciente no WhatsApp dele
```

`REMARCAR PA-2026-0000` faz o inverso: apaga o evento, o horário volta para o
formulário e o paciente é avisado de que a recepção vai entrar em contato.

---

## O painel do médico

Locais de atendimento **não ficam no código**. O médico entra em `/admin` com senha
e cadastra, edita, liga e desliga os locais sozinho. O formulário do paciente reflete
na hora, sem reiniciar nada.

Cada local tem: nome, ID da agenda do Google, **faixas de atendimento**, duração da
consulta, intervalo, **pacientes por horário**, antecedência mínima, por quantos dias
abrir a agenda, endereço e telefone. Ele também edita o próprio nome/CRM e o WhatsApp
da recepção.

**Faixas de atendimento.** O médico não atende o mesmo horário todos os dias, então o
expediente é uma lista de faixas — cada uma com seus dias e seu horário:

```
Seg, Ter, Qua  →  07:30 às 12:00
Qui            →  14:00 às 17:00
```

Sexta simplesmente não aparece. Duas faixas no mesmo dia cobrem o dia partido (manhã
e tarde). A validação recusa faixas que se sobreponham no mesmo dia e faixas curtas
demais para caber uma consulta inteira.

**Pacientes por horário.** Se o médico atende dois no mesmo horário, a vaga só fecha
quando as duas estiverem tomadas — e a recepção recebe "2ª de 2 consultas neste
horário" na mensagem. Isso obrigou uma mudança na leitura do Google: o `freeBusy`
funde períodos sobrepostos num bloco só e não serviria para contar, então a agenda do
próprio local é lida evento a evento (`events.list`). As outras agendas continuam por
`freeBusy` — ali só interessa se está ocupado, não quantos.

Três coisas que o painel resolve e que valem estar explícitas:

**Testar acesso antes de salvar.** Ao colar o ID de uma agenda nova, um botão consulta
o Google e responde uma de três coisas: conectado com permissão correta, compartilhada
mas só com leitura, ou não encontrada. É o passo em que todo mundo erra, e agora ele
descobre na hora em vez de dias depois com um paciente reclamando. O teste usa
`calendarList.get`, então nada é escrito na agenda dele.

**Desligar em vez de excluir.** Parou de atender num hospital? Desligar tira o local do
formulário imediatamente, mas mantém o cadastro e não toca nas consultas que já estão
marcadas. Se voltar a atender lá, é um clique. Excluir existe, mas o painel empurra
para desligar.

**Prévia da grade.** Enquanto ele mexe em horário e duração, a tela mostra os horários
que aquilo vai gerar ("6 consultas por dia · Sex, 09:00 09:30 …"). Erro de configuração
aparece antes de salvar, não depois.

### O site também é editável

Uma segunda aba do painel — **Site** — controla tudo que o paciente lê. Nada disso
é código:

- **Ordem das seções.** Setas ↑↓ mudam a sequência (dá para colocar o agendamento
  logo abaixo da introdução, por exemplo) e cada seção pode ser ocultada. A de
  agendamento é a única que não pode sumir — é o que o paciente veio fazer ali.
- **Início:** título, texto de apresentação, rótulos dos botões, credenciais e os
  números em destaque.
- **Foto:** enviada do computador ou por endereço de uma imagem já hospedada. O
  navegador reduz para 1000px e converte para JPEG **antes** de subir, o que evita
  trazer biblioteca de imagem para o servidor e faz o upload de uma foto de celular
  levar menos de um segundo.
- **Sobre:** parágrafos, áreas de atuação (com marca de destaque) e formação —
  todos como listas que ele adiciona, remove e reordena.
- **Onde atendo, agendamento e dúvidas:** títulos, descrições, o aviso de urgência,
  a lista do que levar na consulta e as perguntas frequentes.
- **Rodapé:** as linhas de aviso. Nome e CRM entram sozinhos.

A página do paciente é montada a partir disso: `public/index.html` virou uma casca
com um `<template>` por seção, e o `app.js` clona os moldes na ordem configurada.
Trocar a ordem no painel muda o site na hora, sem deploy.

### Onde isso é guardado

`dados/config.json`, escrito de forma atômica (grava num temporário e renomeia), porque
um agendamento pode estar acontecendo no mesmo instante em que ele salva. O arquivo está
no `.gitignore`: tem telefone da recepção e IDs de agenda, e é diferente em cada instalação.

O `.env` continua existindo para o que é infraestrutura — porta, fuso, credencial do
Google, driver de WhatsApp, senha do painel. Na primeira execução, se ainda não existe
`dados/config.json`, ele é semeado a partir do `.env` e de `config/hospitais.json`.
Depois disso o painel é a fonte da verdade.

> **Hospedagem com disco efêmero** (plano free do Render e parecidos) apaga
> `dados/config.json` a cada deploy, e o médico perde o que cadastrou. É um dos
> motivos de este sistema pedir VPS — veja [`IMPLANTACAO-VPS.md`](IMPLANTACAO-VPS.md).

### Senha do painel

```bash
npm run senha       # pergunta a senha e imprime as duas linhas do .env
```

Guarda a senha como scrypt com salt por senha — nunca em texto. A sessão é um cookie
assinado com HMAC (`HttpOnly`, `SameSite=Lax`, `Secure` em produção), válido por 12 horas.
Oito tentativas erradas de um mesmo IP bloqueiam por 15 minutos.

**O painel precisa estar atrás de HTTPS em produção.** Sem isso a senha trafega em claro.

---

## Custo: como fica tudo de graça

**O fluxo inteiro roda sem custo de mensagem** usando `WA_DRIVER=wwebjs`, que
conversa pelo WhatsApp Web no número que o consultório já tem. Não há cobrança
por mensagem, nem template para aprovar, nem número novo para contratar.

A Cloud API oficial da Meta **cobra** pelas mensagens que o *sistema* inicia
(as chamadas utility/marketing). Respostas dentro de uma conversa que a pessoa
começou não são cobradas, mas o nosso caso é justamente o contrário: quem
começa a conversa é o sistema, tanto com a recepcionista quanto com o paciente.
Os valores e as regras da Meta mudam de tempos em tempos — se um dia essa opção
for considerada, vale conferir a tabela vigente antes de decidir.

### O que se ganha e o que se perde

| | `wwebjs` (recomendado) | `cloud` (oficial) |
|---|---|---|
| Custo por mensagem | **zero** | cobrado |
| Número | o que o consultório já usa | precisa de um dedicado |
| Mensagem para o paciente | texto livre | só template aprovado |
| Confirmação por botão | não, ela digita | sim |
| Estabilidade | depende da sessão do WhatsApp Web | alta |
| Situação perante a Meta | não é oficial | oficial |

O código trata os dois do mesmo jeito: trocar é mudar `WA_DRIVER` no `.env`.
Comece grátis; se um dia o volume justificar, a migração é de uma linha.

### Para o `wwebjs` durar

- Use o **número do consultório**, não o pessoal do médico.
- O volume aqui é baixo e conversacional (algumas mensagens por dia, para uma
  recepcionista e para pacientes que estão esperando contato). É o cenário de
  menor risco de bloqueio.
- Nada de disparo em massa ou propaganda: é isso que derruba número.
- A sessão é escaneada uma vez (`npm run wa:login`) e fica salva em disco. Se
  cair, é só reescanear — os agendamentos continuam entrando na agenda do Google
  de qualquer forma, e o aviso pendente aparece no log.

---

## Rodando

```bash
cd app
cp .env.example .env      # preencha CAL_H1, CAL_H2 e o caminho da credencial
npm install
npm run senha             # cria a senha do painel (imprime 2 linhas para o .env)
npm test                  # 102 testes, tudo offline
npm start                 # http://localhost:3000
```

Com `WA_DRIVER=log` (o padrão) nada é enviado de verdade: as mensagens aparecem
no terminal. Dá para desenvolver e demonstrar o sistema inteiro assim.

Para ligar o WhatsApp de verdade:

```bash
# no .env: WA_DRIVER=wwebjs e WA_RECEPCAO=55629XXXXXXXX
npm run wa:login          # escaneia o QR uma vez com o WhatsApp do consultório
npm start
```

### Estrutura

```
app/
  config/hospitais.json    grade de atendimento (dias, horários, duração)
  src/
    tempo.js               datas e fuso, sem dependência externa
    disponibilidade.js     regra de quais horários podem ser oferecidos (pura)
    validacao.js           o que chega do navegador não é confiável (pura)
    protocolo.js           PA-2026-0000 e a leitura dos comandos (pura)
    mensagens.js           todo texto que sai pelo WhatsApp
    google-agenda.js       freebusy, criar, confirmar, liberar, testar acesso
    dados.js               config editável pelo painel, gravada em disco (pura)
    pagina.js              o conteúdo padrão do site (pura)
    auth.js                senha e sessão do painel, sem dependência (pura)
    whatsapp/              log | wwebjs | cloud, mesma interface
    agendamento.js         a orquestração
    rotas-admin.js         a API do painel
    server.js              rotas HTTP
  dados/config.json        o que o médico edita (fora do Git)
  public/                  a página que o paciente vê (moldes + montagem)
  public/admin/            o painel: agenda e conteúdo do site
  dados/midia/             a foto enviada pelo painel
  deploy/                  PM2, nginx, systemd e backup
  tests/                   102 testes, sem rede
```

As quatro primeiras são funções puras — é por isso que dá para testar as regras
de horário, fuso e validação sem Google e sem WhatsApp.

### Rotas

| Rota | Para quê |
|---|---|
| `GET /api/hospitais` | monta a tela 1 |
| `GET /api/horarios?hospital=h1&dias=8` | grade já descontando o ocupado |
| `POST /api/agendar` | cria o pré-agendamento |
| `POST /webhook/whatsapp` | respostas da recepcionista (driver `cloud`) |
| `POST /tarefas/cobrar-pendentes` | cobrança das 24h (cron externo) |
| `GET /saude` | health check |
| `/admin` | painel do médico (tela) |
| `POST /admin/api/entrar` · `/sair` | sessão do painel |
| `GET·PUT /admin/api/config` | dados do médico e da recepção |
| `POST·PUT·DELETE /admin/api/hospitais` | locais de atendimento |
| `POST /admin/api/testar-agenda` | confere o compartilhamento no Google |
| `GET·PUT /admin/api/pagina` | conteúdo e ordem das seções do site |
| `POST /admin/api/foto` | foto do médico |
| `GET /api/pagina` | o que a página do paciente monta (público) |

---

## Decisões que valem conhecer

**O evento entra como provisório.** O horário é bloqueado no instante do envio —
é isso que impede dois pacientes de pegarem o mesmo slot. Mas nasce com
`status: tentative` e prefixo `PRÉ ·`, então o médico bate o olho na agenda e
sabe o que já passou pela recepção.

**A grade vem da configuração, não do Google.** As faixas de atendimento são
definidas no painel. O Google é consultado só para saber o que está ocupado. Assim um
compromisso pessoal na agenda nunca vira "horário de consulta".

**Ocupar e bloquear são coisas diferentes.** Consulta marcada *neste* local conta
contra as vagas do horário; compromisso em outro hospital, na agenda pessoal ou um
evento de dia inteiro **bloqueia** o horário inteiro, por mais vagas que houvesse.

**As duas agendas são consultadas sempre.** Mesmo quando o paciente escolheu o
Hospital 2, o sistema confere o Hospital 1: o médico é um só e não pode estar em
dois lugares às 14h.

**Só a recepcionista comanda.** `CONFIRMAR` e `REMARCAR` só valem vindos do
número em `WA_RECEPCAO`. Comando de outro número é ignorado e registrado no log.

**Aviso que falha não desfaz agendamento.** Se o WhatsApp cair na hora do envio,
o evento continua na agenda e o erro vai para o log. O contrário — avisar e não
marcar — seria pior.

---

## Cuidados que não dá para pular

- **LGPD.** Motivo da consulta e convênio são dado de saúde. O consentimento
  está no formulário e é obrigatório; falta definir prazo de descarte e publicar
  um aviso de privacidade de verdade na página.
- **Não é canal de urgência.** Está dito no rodapé, na barra do agendamento e na
  tela de confirmação.
- **Credencial do Google é senha.** `credenciais.json` e `.env` estão no
  `.gitignore`. Nunca mande por WhatsApp.
- **CFM.** Publicidade médica tem regra (Resolução CFM 1.974/2011 e
  atualizações): nada de promessa de resultado, foto de antes/depois ou
  autopromoção. Vale o médico ler o texto final da página.

---

## O que falta

1. Os IDs das duas agendas do Google (o médico manda) — daí em diante ele mesmo
   cadastra novos locais pelo painel.
2. Foto, bio, formação e áreas de atuação — o médico mesmo preenche pela aba Site.
3. Convênios aceitos (ainda é lista fixa no formulário).
4. Publicar na VPS com domínio e HTTPS — o passo a passo está em
   [`IMPLANTACAO-VPS.md`](IMPLANTACAO-VPS.md).
