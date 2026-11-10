# Backlog — ideias guardadas

Funcionalidades que já foram discutidas e **não entraram por enquanto**. Nada aqui
está implementado. Quando uma for aprovada, ela sai desta lista.

Última revisão: 10/11/2026.

## A. Guardadas para talvez fazer depois

| # | Ideia | O que faria | Por que ficou guardada |
|---|---|---|---|
| A1 | Respostas da experimental caem na SoFIA | Confirmação e mensagem de falta sairiam pelo número da SoFIA; se a lead responder "não vou poder", a SoFIA remarca sozinha. | O objetivo é criar relacionamento com uma pessoa; esse contato fica com a recepção. |
| A2 | SoFIA atende aluna o dia todo | Hoje ela não responde aluna no horário da recepção (05:45–16:30). Passaria a responder sempre no que resolve sozinha (remarcar, contrato, reposições). | Por enquanto não. |
| A3 | Trancamento pela SoFIA | A SoFIA já informa os dias disponíveis; faria o trancamento pelo site do EVO (a API não tem esse comando). | Por enquanto não. É a mais arriscada. |
| A4 | Fila da recepção no painel (era C4) | Lista diária do que precisa de uma pessoa: quem fez a experimental ontem e não fechou, alunas sumidas, quem pediu humano na SoFIA, contratos sem assinatura. A recepção faz o contato; o sistema só monta a lista. | Ainda não vamos implementar. |

## B. Recusadas ("não precisa")

| # | Ideia | O que faria | Motivo |
|---|---|---|---|
| B1 | Retorno automático depois da experimental | SoFIA manda mensagem 1–2 dias depois para quem fez a aula e não fechou. | A recepção já faz esse contato pelo celular do Studio, com áudio da professora. |
| B2 | Ligar o "Sentimos sua falta" | Chama de volta, toda segunda, alunas ausentes há 14+ dias. Está pronto e desligado. | Não quis ligar. |
| B3 | Pagamento: fechar o mês | Botão que congela os valores do mês, guarda os relatórios e baixa todos os PDFs. | Não precisa. |
| B4 | Aviso imediato quando o WhatsApp desconectar | Alerta no celular quando o robô ou a SoFIA caem. | Não precisa. |
| B5 | Aviso antes do bloqueio do app | SoFIA avisa a aluna por volta do 8º dia de atraso, antes de cortar o app. | Escolheu "só bloquear". |
| B6 | Campanha pula quem está em conversa | A campanha adiaria quem está sendo atendida ou escreveu nas últimas horas. | Não precisa pular; ficou só o aviso 📣 e o botão "Não enviar para ela". |
| B7 | Aluna pede boleto/PIX e a SoFIA envia | SoFIA mandaria o boleto, o PIX ou o link de pagamento da própria aluna. | Não precisa. |
| B8 | Renovação e matrícula com link de contratação | Mensagem de renovação e SoFIA mandariam link para contratar online. | Não precisa. |
| B9 | Mensagem de contrato sem assinatura pela SoFIA | Mandaria pelo número da SoFIA para ela responder dúvidas sobre o link. | Aluna é relacionamento: continua saindo pelo robô (celular do studio). |

## C. Sugeridas e ainda sem resposta

| # | Ideia | O que faria |
|---|---|---|
| C1 | SoFIA apaga sozinha o login travado | Se falhar 3 vezes seguidas ao abrir o WhatsApp, apaga o login antigo e mostra QR novo (evita o que aconteceu no Guará). |
| C2 | Mensagem para a aluna no momento do bloqueio do app | "Seu acesso ao app foi suspenso por pendência financeira; volta sozinho ao regularizar." |
| C3 | Entrada da aluna nova: boas-vindas e grupos | O acesso ao app já é criado pelo EVO. Faltaria mandar boas-vindas e colocar nos grupos. |

## D. Descartadas porque já existem

- **Acesso ao app da aluna nova:** o EVO cria ao lançar o contrato.
- **Lista de espera:** as alunas já têm pelo app; para experimental não faz sentido (a ideia é ela ver que a turma lota e tentar outra).

## E. Pendências (não são ideias novas)

- **Trocar a chave da API do EVO** (ficou exposta no repositório público antigo e em prints). Depois, atualizar o `.env` de cada unidade.
- **Imagens padrão das mensagens:** baixar o pacote do Bueno (WhatsApp → Configuração → Imagens de todas as mensagens) e colocar em `Experimental/padrao/mensagens-fotos.json`.
- **Fila de confirmações em caminho estranho:** sem `STUDIO_OUTBOX_FILE` no `.env`, o robô grava a fila num arquivo com nome começando por `C:` dentro de `Experimental`. Funciona, mas vale apontar para um caminho normal.
- **Bloqueio do app:** está em modo teste; conferir a lista por alguns dias antes de ligar.
