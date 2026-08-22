# Agendamento de consultas — oncologista

Página do médico + formulário que agenda direto na **agenda do Google do hospital
escolhido** e avisa a **recepcionista pelo WhatsApp**, que confirma respondendo
uma mensagem.

| | |
|---|---|
| [`prototipo.html`](prototipo.html) | Esboço de apresentação. Abre no navegador, tudo simulado, serve para mostrar a ideia ao médico. |
| [`GUIA-AGENDAS-GOOGLE.md`](GUIA-AGENDAS-GOOGLE.md) | Passo a passo para criar e compartilhar as duas agendas. É o que o médico precisa fazer. |
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
npm test                  # 45 testes, tudo offline
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
    google-agenda.js       freebusy, criar, confirmar, liberar
    whatsapp/              log | wwebjs | cloud, mesma interface
    agendamento.js         a orquestração
    server.js              rotas HTTP
  public/                  a página que o paciente vê
  tests/                   45 testes, sem rede
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

---

## Decisões que valem conhecer

**O evento entra como provisório.** O horário é bloqueado no instante do envio —
é isso que impede dois pacientes de pegarem o mesmo slot. Mas nasce com
`status: tentative` e prefixo `PRÉ ·`, então o médico bate o olho na agenda e
sabe o que já passou pela recepção.

**A grade vem da configuração, não do Google.** Dias e horários de ambulatório
ficam em `config/hospitais.json`. O Google é consultado só para saber o que está
ocupado. Assim um compromisso pessoal na agenda nunca vira "horário de consulta".

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

1. Informações reais do médico: nome, CRM/RQE, foto, bio, formação, áreas.
2. Dos hospitais: nome, endereço, telefone, dias e horários, convênios aceitos.
3. Número de WhatsApp da recepcionista.
4. Regra de cancelamento e antecedência mínima (hoje: 24h).
5. Publicar com domínio próprio e HTTPS, e agendar o cron da cobrança de 24h.
