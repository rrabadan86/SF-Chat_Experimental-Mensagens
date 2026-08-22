# Agendamento de consultas — oncologista

Esboço de apresentação: página do médico + formulário de agendamento que lança na
**agenda do Google do hospital escolhido** e avisa a **recepcionista pelo WhatsApp**.

- Protótipo clicável: [`prototipo.html`](prototipo.html) — abre direto no navegador, não precisa de servidor.
  Todo o comportamento é simulado no próprio navegador (horários, evento na agenda, mensagem
  do WhatsApp). Nada é enviado para lugar nenhum.

## O que o protótipo mostra

1. **Apresentação do médico** — foto, bio, formação, áreas de atuação e os dois locais de atendimento.
2. **Agendamento em 4 passos** — hospital → dia e horário → dados do paciente → revisão.
3. **Bastidores** (aparece depois de enviar; **não** aparece para o paciente de verdade) —
   o evento como ele entra no Google Agenda e a mensagem exata que chega no WhatsApp da recepção,
   inclusive a resposta `CONFIRMAR` que muda o status do evento.

Tudo que está como "a definir" no protótipo é informação que precisa vir do médico.

## Como funcionaria de verdade

```
Paciente (navegador)
      │  1. GET /api/horarios?hospital=h1&de=…&ate=…
      ▼
  Servidor  ──► Google Calendar API  freebusy.query( calendarId do hospital )
      │         devolve só os horários realmente livres
      │
      │  2. POST /api/agendar  { hospital, data, hora, dados do paciente }
      ▼
  Servidor  ──► Google Calendar API  events.insert( calendarId do hospital )
      │           título:  "PRÉ · <paciente> — <tipo>"
      │           status:  tentative
      │           extendedProperties.private.protocolo = PA-2026-0000
      │
      └──────► WhatsApp da recepcionista  (mensagem pronta com os dados + protocolo)

  Recepcionista responde "CONFIRMAR PA-2026-0000"
      │
      ▼
  Servidor  ──► events.patch( status: confirmed, tira o "PRÉ ·" do título )
      └──────► avisa o paciente no WhatsApp dele
```

### Google Calendar — as duas agendas

Criar **duas agendas separadas** na conta Google do médico (Hospital 1 e Hospital 2) e
compartilhar as duas com uma *service account* do Google Cloud, com permissão de
"Fazer alterações nos eventos". O `calendarId` de cada uma vai na configuração:

```
CAL_HOSPITAL_1=xxxxxxxx@group.calendar.google.com
CAL_HOSPITAL_2=yyyyyyyy@group.calendar.google.com
```

Vantagem de usar duas agendas em vez de uma com etiquetas: o médico vê cada hospital
numa cor no celular, pode compartilhar só a agenda do Hospital 1 com a recepção de lá,
e o `freebusy` já responde por local.

Ponto importante: o `freebusy` deve consultar **as duas** agendas antes de oferecer um
horário, senão o sistema pode marcar Hospital 2 às 14h enquanto o médico já tem algo às
14h no Hospital 1. A grade é por hospital, mas o médico é um só.

### Grade de horários

Definida na configuração, não no Google: dias da semana, hora inicial, hora final e
duração da consulta por hospital. O Google só é consultado para saber o que já está
ocupado. Isso evita que um compromisso pessoal na agenda vire "horário de consulta".

### WhatsApp para a recepcionista

Duas opções, e a escolha muda custo e risco:

| | API Oficial (WhatsApp Cloud API) | Biblioteca não-oficial (whatsapp-web.js) |
|---|---|---|
| Custo | por conversa iniciada | zero |
| Estabilidade | alta, é da Meta | depende do WhatsApp Web logado |
| Número | precisa de número dedicado | usa o número atual do consultório |
| Risco de bloqueio | nenhum | existe |
| Mensagem para quem não escreveu antes | só com template aprovado | livre |

Para avisar **a recepcionista** (que é uma pessoa só, sempre a mesma), qualquer uma serve.
Para avisar **o paciente**, a API oficial é a recomendada — mensagem iniciada pelo sistema
para alguém que não escreveu antes exige template aprovado.

### Confirmação pela recepcionista

Ela responde `CONFIRMAR PA-2026-0000` (ou toca num botão, se for API oficial). O sistema:

1. acha o evento pela `extendedProperties.private.protocolo`;
2. muda para `status: confirmed` e tira o prefixo `PRÉ ·` do título;
3. manda a confirmação para o WhatsApp do paciente.

`REMARCAR` devolve o horário para a grade e avisa o paciente. Se ninguém responder em
24h, o sistema lembra a recepcionista — ou libera o horário, se o médico preferir.

## Cuidados que não dá para pular

- **LGPD / dado sensível.** Motivo da consulta e convênio são dado de saúde. Precisa de
  consentimento explícito (já está no formulário), HTTPS, acesso restrito, prazo de
  descarte e um aviso de privacidade de verdade na página.
- **Não é canal de urgência.** O formulário precisa dizer isso em letra visível — já está
  no protótipo, no rodapé e na barra lateral do agendamento.
- **Dois pacientes, o mesmo horário.** O evento entra no Google no momento do envio
  (mesmo como provisório), justamente para travar o slot.
- **CFM.** Publicidade médica tem regra (Resolução CFM 1.974/2011 e atualizações):
  nada de promessa de resultado, foto de antes/depois ou autopromoção sensacionalista.
  Vale o médico dar uma olhada no texto final.

## Próximos passos sugeridos

1. Apresentar o protótipo e colher as informações da lista "Falta definir com o médico".
2. Decidir API oficial x não-oficial para o WhatsApp.
3. Criar as duas agendas e a service account.
4. Implementar o backend (formulário → Google Agenda → WhatsApp → confirmação).
5. Publicar com domínio próprio e HTTPS.
