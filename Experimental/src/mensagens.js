/**
 * Cofre central de mensagens editáveis.
 *
 * Os textos "principais" que o robô envia (confirmações, follow-up, faltas,
 * renovação, aniversário, Instagram, Circuito) ficam aqui como PADRÃO. As
 * edições feitas no painel são gravadas em data/mensagens.json e têm
 * prioridade sobre o padrão.
 *
 * Cada texto usa marcadores no formato {nome}, {horario}, {professora}...
 * que são trocados pelos valores reais na hora do envio (render).
 *
 * Como o JSON é lido a cada render(), uma edição no painel vale já no
 * próximo envio — sem precisar reiniciar o robô.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'mensagens.json');
// Foto opcional por mensagem (uma por chave). Só as mensagens com foto:true no
// catálogo aceitam. O nome do arquivo é a própria chave (validada) — sem risco
// de path traversal.
const FOTOS_DIR = path.resolve(__dirname, '..', 'data', 'mensagens-fotos');

// Catálogo: ordem, título, descrição e variáveis de cada mensagem. Também
// alimenta o painel de edição. NÃO mude as chaves (o código depende delas).
const CATALOGO = [
  {
    chave: 'confirmacao_hoje',
    titulo: 'Confirmação — aula de hoje',
    quando: 'Enviada às 08:30 (seg–sáb) para quem tem experimental hoje.',
    vars: [['nome', 'primeiro nome da lead'], ['horario', 'horário da aula'], ['professora', 'professora da aula (quando o EVO informa)'], ['data', 'data da aula (dd/mm/aaaa)']],
    padrao: 'Olá, {nome}! 😊\n\nTudo bem? Aqui é do {studio}!\n\nEstamos mandando essa mensagem para confirmar a sua aula experimental de logo mais que está agendada para hoje às {horario}.\n\nPode confirmar sua presença? Estamos te esperando! 💪',
  },
  {
    chave: 'confirmacao_amanha',
    titulo: 'Confirmação — aula de amanhã',
    quando: 'Enviada às 15:30 (dom–sex) para quem tem experimental amanhã.',
    vars: [['nome', 'primeiro nome da lead'], ['horario', 'horário da aula'], ['professora', 'professora da aula (quando o EVO informa)'], ['data', 'data da aula (dd/mm/aaaa)']],
    padrao: 'Olá, {nome}! 😊\n\nTudo bem? Aqui é do {studio}!\n\nEstamos mandando essa mensagem para confirmar a sua aula experimental que está agendada para amanhã às {horario}.\n\nPode confirmar sua presença? Estamos te esperando! 💪',
  },
  {
    chave: 'confirmacao_experimental',
    titulo: 'Confirmação — aula experimental (agendada pelo site/Sofia)',
    quando: 'Enviada logo após a lead agendar pelo formulário ou pela Sofia. Só é usada aqui se você EDITAR este texto; sem edição, vale o texto padrão do sistema.',
    vars: [['nome', 'primeiro nome da lead'], ['quando', 'dia e hora amigável, ex.: sexta-feira, 28/08 às 16:15']],
    padrao: 'Oie, {nome}! 🎉 Tudo bem? Aqui é do *{studio}*.\n\nEstou mandando essa mensagem para informar que a sua aula experimental está confirmada para *{quando}*.\nQualquer dúvida que tiver, ou precisar remarcar a sua aula, pode me chamar por aqui.❤️\n\n*Endereço:* [ENDEREÇO DA UNIDADE]\n*Localização:* [LINK DO MAPA DA UNIDADE]\n\nSe possível, tente chegar 10 minutos antes para você conhecer o Studio e conversarmos! 💪\nMuito bem vinda ao #SlimFit - A Revolução do Treinamento Feminino! ❤️',
  },
  {
    chave: 'confirmacao_experimental_express',
    titulo: 'Confirmação — aula experimental (Cadastro Express)',
    quando: 'Enviada só quando a aula é agendada pelo Cadastro Express (aba WhatsApp → Express). O formulário e a Sofia usam o texto de cima. Sem edição aqui, vale o texto padrão abaixo.',
    vars: [['nome', 'primeiro nome da lead'], ['quando', 'dia e hora amigável, ex.: sexta-feira, 28/08 às 16:15']],
    padrao: 'Oie, {nome}! 🎉 Tudo bem? Aqui é do *{studio}*.\n\nSua aula experimental ficou confirmada para *{quando}*.\nQualquer dúvida, ou se precisar remarcar, é só me chamar por aqui. ❤️\n\n*Endereço:* [ENDEREÇO DA UNIDADE]\n*Localização:* [LINK DO MAPA DA UNIDADE]\n\nChegue 10 minutinhos antes para conhecer o Studio com calma! 💪\nSeja muito bem-vinda ao #SlimFit - A Revolução do Treinamento Feminino! ❤️',
  },
  {
    chave: 'confirmacao_sem_resposta',
    titulo: 'Confirmação — sem resposta (2ª mensagem)',
    quando: 'Sai só para quem NÃO respondeu nem reagiu (❤️ 👍…) à confirmação e com quem a recepção não falou à mão depois. Um horário para quem recebeu a "aula de hoje" e outro para a "aula de amanhã" — deixe pelo menos 1h30 depois da confirmação. Uma vez por aula. Só ter lido não conta como resposta.',
    vars: [['nome', 'primeiro nome da lead'], ['horario', 'horário da aula'], ['quando', '"hoje", "amanhã" ou "no dia dd/mm"']],
    padrao: 'Oi, {nome}! 😊 Passando só para confirmar: podemos contar com você {quando} às {horario}?\n\nÉ só responder com um 👍 — estamos te esperando! 💪',
    exemplos: { quando: 'hoje', horario: '16:15' },
  },
  {
    chave: 'confirmacao_sem_resposta_equipe',
    titulo: 'Confirmação — sem resposta (lista para o grupo da equipe)',
    quando: 'Vai para o GRUPO DA EQUIPE com quem recebeu a 2ª mensagem e continua sem responder (aula ainda pela frente), para a recepção ligar ou mandar um áudio. Um horário para a "aula de hoje" (ex.: 13:00) e outro para a "aula de amanhã" (no dia da aula, cedo). Cada pessoa entra uma vez.',
    vars: [['lista', 'uma linha por pessoa: horário (dia) — nome — telefone']],
    padrao: '📵 *Não responderam a confirmação da aula experimental*\n\n{lista}\n\nVale uma ligação ou um áudio da recepção 💚',
    exemplos: { lista: '• 16:15 (hoje) — Lilian Carneiro — (62) 98322-0000\n• 18:15 (hoje) — Carla Mendes — (62) 99111-2222' },
  },
  {
    chave: 'followup_encerramento',
    titulo: 'Follow-up — encerramento (sem resposta)',
    quando: 'Sai no DIA SEGUINTE ao follow-up pós-aula, só para quem NÃO respondeu nem reagiu ao follow-up, com quem a recepção não falou à mão e que não virou aluna. Um horário para o follow-up da manhã e outro para o da tarde. Uma vez por follow-up.',
    vars: [['nome', 'primeiro nome da aluna'], ['professora', 'primeiro nome da professora da aula']],
    padrao: 'Oie, {nome}! Tudo bem? 😊\n\nAqui é a {professora}, a professora que te deu a aula experimental no Studio SlimFit! 💪🏼\n\nComo não tive notícias suas, vou encerrar seu atendimento por aqui. Mas antes queria te fazer uma perguntinha rápida: o que pesou na sua decisão?\n\n1️⃣ Quero fazer mais uma aula experimental\n2️⃣ O horário não encaixou\n3️⃣ O valor\n4️⃣ Agora não é o momento\n\nÉ só responder com o número! Tenho certeza que teríamos ótimos resultados juntas. 🫶🏼',
    exemplos: { professora: 'Tay' },
  },
  {
    chave: 'followup',
    titulo: 'Follow-up pós-aula (ainda não fechou)',
    quando: 'Enviada 10:30 / 16:00 para quem fez a experimental no dia anterior.',
    vars: [['nome', 'primeiro nome da aluna'], ['professora', 'nome da professora']],
    padrao: 'Oie! Tudo bem?\n\nSegue áudio que a professora {professora} fez sobre a sua aula experimental! =)\n\nSei que a primeira aula sempre é mais difícil, principalmente por ser uma metodologia nova!\n\nMas agora que você já deu o primeiro passo 👏, o que acha de vir para mais uma aula e darmos andamento da sua matrícula?\n\nTe aguardo!!! 🥰',
  },
  {
    chave: 'followup_aluna',
    titulo: 'Follow-up pós-aula (já virou aluna)',
    quando: 'Mesmo horário do follow-up, mas para quem já fechou contrato.',
    vars: [['nome', 'primeiro nome da aluna'], ['professora', 'nome da professora']],
    padrao: 'Oie! Tudo bem?\n\nQue alegria ter você com a gente! 🥰\n\nSegue um áudio que a professora {professora} preparou sobre a sua aula!\n\nSeja muito bem-vinda ao SlimFit! 💪\n\nEstamos muito felizes com a sua decisão. Qualquer dúvida que tiver sobre o APP pode me acionar!\n\nConte conosco! ❤️',
  },
  {
    chave: 'no_show',
    titulo: 'Faltou (no-show) — convite para remarcar',
    quando: 'Enviada 11:30 / 19:30 para quem faltou à experimental.',
    vars: [['nome', 'primeiro nome da lead'], ['horario', 'horário entre parênteses, ex.: " (09:00)" — pode ficar vazio']],
    padrao: 'Oi, {nome}! 😊 Tudo bem?\n\nNotamos que você não conseguiu comparecer à sua aula experimental de hoje{horario}. Acontece! 💛\n\nQue tal remarcar? Vai ser um prazer te receber. É só me responder por aqui que a gente encontra um novo horário pra você! 🙌',
  },
  {
    chave: 'renovacao',
    titulo: 'Renovação de contrato',
    quando: 'Enviada às 14:30 para quem vence dentro do prazo de antecedência (configurável abaixo; padrão 7 dias).',
    vars: [['nome', 'primeiro nome da aluna'], ['data', 'data de vencimento'], ['contrato', 'nome do plano/contrato da aluna (ex.: COPA SLIM 2026 - C.C. - GRUPO 1)']],
    padrao: 'Oi, {nome}! Tudo bem? 😊\nQue alegria ter você no SlimFit! 🥳\nEstou enviando essa mensagem para avisar que o seu plano vence no dia {data}. A gente ia adorar continuar com você firme nos treinos! ❤️\nPodemos dar andamento na renovação? Prefere manter o mesmo plano ou aumentar a frequência? 💪\nQualquer dúvida, é só me chamar! 😉',
  },
  {
    chave: 'ausentes',
    titulo: 'Ausentes / faltantes (grupo da equipe)',
    quando: 'Enviada seg 06:10 no grupo da equipe: alunas ATIVAS sem presença há N+ dias. A lista (nome — última presença) é montada automaticamente e entra em {lista}.',
    vars: [['dias', 'nº de dias do corte (ex.: 10)'], ['lista', 'a lista das faltantes, gerada automaticamente — mantenha o {lista} no texto']],
    padrao: 'Professoras, segue abaixo a listagem de alunas faltantes a mais de {dias} dias, com a data da última presença dela. Por favor, entrem em contato no privado para entender o que está acontecendo e incentivar a retomada às aulas:\n\n{lista}',
  },
  {
    chave: 'aniversariantes_mes',
    titulo: 'Aniversariantes do mês (grupo da equipe)',
    quando: 'Enviada no início do mês no grupo da equipe. A lista (dia — nome) é montada automaticamente e entra em {lista}. Se não houver ninguém no mês, é enviado um aviso curto fixo.',
    vars: [['mes', 'nome do mês (ex.: Setembro)'], ['lista', 'a lista das aniversariantes (dia — nome) — mantenha o {lista} no texto']],
    padrao: '🎂 *Aniversariantes de {mes}* 🎉\n\n{lista}\n\nVamos celebrar cada uma delas! 💪❤️',
  },
  {
    chave: 'renovacoes_mes',
    titulo: 'Contratos a vencer no mês (grupo da equipe)',
    quando: 'Enviada dia 28 às 09:07 no grupo da equipe: alunas cujo contrato vence no MÊS SEGUINTE. A lista (dia/mês — nome) é montada automaticamente e entra em {lista}. Se ninguém vence no mês, é enviado um aviso curto fixo.',
    vars: [['mes', 'nome do mês-alvo (ex.: Outubro)'], ['lista', 'a lista dos contratos a vencer (dia/mês — nome) — mantenha o {lista} no texto']],
    padrao: '📄 *Contratos a vencer em {mes}*\n\n{lista}\n\nBora cuidar das renovações com carinho! 💪❤️',
  },
  {
    chave: 'aniversario',
    foto: true,
    titulo: 'Aniversário (nos grupos)',
    quando: 'Enviada às 08:00. A aniversariante é @marcada onde está {aluna}.',
    vars: [['aluna', 'a @menção da aniversariante — mantenha o {aluna} no texto'], ['nome', 'primeiro nome da aniversariante (texto normal, sem marcar)']],
    // No preview/teste o {aluna} representa a @menção → mostramos "@Maria"
    // (assim não fica "Maria Maria"; no envio real vira a marcação de verdade).
    exemplos: { aluna: '@Maria' },
    padrao: 'Hoje é aniversário da {aluna}! 🥳🎉\n\nMuitas felicidades, saúde e sucesso!!! Que este novo ciclo venha repleto de conquistas e alegria!! Aproveite o seu dia! ❤️',
  },
  {
    chave: 'aniversario_ex',
    foto: true,
    titulo: 'Aniversário — ex-alunas (direto no WhatsApp)',
    quando: 'Enviada no aniversário de quem JÁ foi aluna (status "Inativos" no EVO). Vai direto no WhatsApp da pessoa (reativação). {aluna} = primeiro nome.',
    vars: [['aluna', 'primeiro nome da ex-aluna']],
    padrao: 'Olá, {aluna}! Como você está?\n\nHoje, no seu aniversário, a saudade de ter você por aqui apertou ainda mais! 🥳\n\nEspero que o seu dia esteja cheio de comemoração e muita endorfina.\n\nMas lembre-se: nossas portas continuam abertas para quando quiser voltar e começar esse novo ciclo com foco total na sua saúde! 💓\n\nDesejo um feliz aniversário e um ano incrível para você! 💕',
  },
  {
    chave: 'vence_hoje',
    titulo: 'Vence hoje — sem renovação',
    quando: 'No dia do vencimento do contrato, para quem ainda NÃO tem contrato na fila (contrato na fila = já renovou). Quem venceu num dia sem disparo (ex.: domingo desligado) recebe no próximo — o {vencimento} vira "venceu ontem".',
    vars: [['nome', 'primeiro nome da aluna'], ['vencimento', '"vence hoje", "venceu ontem" ou "venceu no dia DD/MM" — preenchido sozinho'], ['contrato', 'nome do plano/contrato da aluna']],
    padrao: 'Oi, {nome}! 😊\nPassando para lembrar que o seu plano {vencimento}.\nPara você não ficar sem treinar, que tal já renovarmos? Pode ser o mesmo plano ou, se preferir, outra frequência. 💛\nQualquer dúvida, estou por aqui!',
  },
  {
    chave: 'assinatura_contrato',
    titulo: 'Contrato sem assinatura',
    quando: 'Lembrete para a aluna ativa cujo contrato vigente ainda NÃO foi assinado no EVO. Leva o link de assinatura DELA ({link} — mantenha no texto). Sai nos dias/horário deste cartão (no máximo uma vez por dia); quando ela assina, para sozinho. Dá para marcar alunas para não receber.',
    vars: [['nome', 'primeiro nome da aluna'], ['plano', 'nome do plano/contrato no EVO'], ['link', 'link de assinatura do contrato dela — mantenha o {link} no texto']],
    padrao: 'Oi, {nome}! Tudo bem? 💛\n\nO contrato do seu plano no {studio} ainda está aguardando a sua assinatura digital.\n\nÉ rapidinho, é só tocar no link abaixo:\n{link}\n\nQualquer dúvida, é só me chamar! 😊',
  },
  {
    chave: 'saida_grupos',
    titulo: 'Saída — não renovou (retira dos grupos)',
    quando: 'Para quem está com o contrato vencido há alguns dias (você escolhe quantos, abaixo — padrão 7) e não renovou (contrato na fila conta como renovação). O robô primeiro RETIRA a pessoa de todos os grupos em comum com o número do Studio e depois manda esta mensagem. Se ela não está em nenhum grupo, nada é enviado.',
    vars: [['nome', 'primeiro nome da aluna']],
    padrao: 'Oie, {nome}!! Tudo bem?\n\nPoxa, que pena que você não continuará mais conosco! Sentiremos muito a sua falta!\n\nVou te retirar do grupo para que não te atrapalhe com as mensagens da turma!\n\nEspero que possa retornar para o SlimFit em breve!\nUma boa semana!! ❤️❤️❤️',
  },
  {
    chave: 'sentimos_falta_1',
    titulo: 'Sentimos sua falta — 1ª mensagem',
    quando: 'Toda segunda (horário abaixo), para a aluna ATIVA e não trancada que está sem treinar há alguns dias (você escolhe quantos, abaixo — padrão 14). Cada aluna recebe uma vez por "sumiço": se ela voltar a treinar e sumir de novo, recomeça.',
    vars: [['nome', 'primeiro nome da aluna'], ['dias', 'há quantos dias ela não vem (pela última presença no EVO)']],
    padrao: 'Oi, {nome}! Tudo bem? 💛\n\nSentimos a sua falta aqui no {studio}! Já faz {dias} dias que você não vem treinar com a gente.\n\nAconteceu alguma coisa? Se a rotina apertou, me conta que eu te ajudo a encontrar o melhor horário para você voltar. 😊',
  },
  {
    chave: 'sentimos_falta_2',
    titulo: 'Sentimos sua falta — 2ª mensagem',
    quando: 'Para quem recebeu a 1ª mensagem e continua sem treinar (nenhuma presença nova no EVO) depois de alguns dias (você escolhe quantos — padrão 10). Sai no mesmo disparo de segunda da 1ª. Depois da 2ª, nada mais até ela voltar.',
    vars: [['nome', 'primeiro nome da aluna'], ['dias', 'há quantos dias ela não vem (pela última presença no EVO)']],
    padrao: 'Oi, {nome}! Tudo bem? 😊\n\nPassando de novo para dizer que a sua turma está te esperando! Já são {dias} dias sem você por aqui, e cada treino conta para os seus resultados. 💪\n\nQue tal voltar esta semana? Me fala o melhor dia que eu já deixo tudo certo para você. 💛',
  },
  {
    chave: 'instagram',
    titulo: 'Boas-vindas no Instagram (DM)',
    quando: 'Enviada às 07:00 para novas seguidoras (em teste).',
    vars: [],
    padrao: 'Seja muito bem vinda ao SlimFit, a Revolução do Treinamento Feminino! ❤️\n\nEstou te presenteando com uma aula experimental gratuita para conhecer a nossa metodologia e o nosso studio! Faça o agendamento através deste link: [LINK DO FORMULÁRIO DA UNIDADE]\n\nNos links abaixo eu explico sobre a nossa metodologia:\n-> O que é o SlimFit: https://www.instagram.com/reel/Crluss-AWPu/\n\n-> Personal X SlimFit: https://www.instagram.com/p/CwkvRzggYrs/\n\nAté mais!',
  },
  {
    chave: 'circuito_convocacao',
    foto: true,
    titulo: 'Circuito — convocatória (quarta)',
    quando: 'Enviada quarta 16:15 no grupo do Circuito — SÓ se houver Circuito no sábado (confere na Grade > Horários antes). A professora é @marcada onde está {professora}.',
    vars: [['professora', 'a @menção da professora — mantenha o {professora} no texto'], ['hora', 'horário da aula de sábado, ex.: 09h45']],
    padrao: '🔥 SÁBADO É DIA DE QUEIMAR CALORIAS NO CIRCUITO! 🔥\n⚡️Comandada pela professora {professora}.\n\nCheckin Aberto!!!\n\n⏰ Sábado às {hora}',
  },
  {
    chave: 'circuito_lembrete',
    foto: true,
    titulo: 'Circuito — lembrete (sexta)',
    quando: 'Enviada sexta 16:15 no grupo do Circuito — SÓ se houver Circuito no sábado (confere na grade antes de enviar). A professora é @marcada onde está {professora} (opcional — pode remover).',
    vars: [['professora', 'a @menção da professora — mantenha o {professora} no texto (opcional)'], ['hora', 'horário da aula de sábado, ex.: 09h45']],
    padrao: '🔥 *É AMANHÃ!* 🔥\n⚡️ Estamos esperando todas vocês com a professora {professora}!\n\n⏰ Sábado às {hora}',
  },
  {
    chave: 'cobranca_recorrente',
    titulo: 'Cobrança — recorrente (cartão, com link)',
    quando: 'Enviada pela SoFIA para a aluna com débito VENCIDO (dias de atraso configuráveis na aba Cobrança) cujo contrato é RECORRENTE (cartão). Leva o link de pagamento. Horário/dias também na aba Cobrança.',
    vars: [['nome', 'primeiro nome da aluna'], ['link', 'link de pagamento dela — mantenha o {link} no texto'], ['valor', 'valor em aberto, ex.: R$ 199,00 (opcional)']],
    padrao: 'Oi, {nome}! 💜 Aqui é do {studio}.\n\nNotamos que ficou um valor em aberto no seu plano. Para regularizar rapidinho é só por este link:\n{link}\n\nQualquer dúvida, é só me chamar por aqui! 😊',
  },
  {
    chave: 'cobranca_boleto',
    titulo: 'Cobrança — boleto vencido (com boleto)',
    quando: 'Enviada pela SoFIA para a aluna com BOLETO em aberto e VENCIDO há X+ dias (X configurável na aba Cobrança). Leva o boleto atualizado no {link}. Horário/dias também na aba Cobrança.',
    vars: [['nome', 'primeiro nome da aluna'], ['vencimento', 'data de vencimento, ex.: 25/09/2026'], ['link', 'link do boleto dela — mantenha o {link} no texto'], ['valor', 'valor do boleto, ex.: R$ 647,00 (opcional)']],
    padrao: 'Olá, {nome}! Tudo bem? 💜\n\nIdentificamos que o boleto da sua mensalidade do {studio}, vencido em {vencimento}, ainda está em aberto.\n\nPara regularizar sem complicação, segue o boleto atualizado:\n{link}\n\nSe já tiver pago, pode desconsiderar. Qualquer dúvida, é só me chamar! 😊',
  },
  {
    chave: 'cobranca_boleto_hoje',
    titulo: 'Cobrança — boleto vence HOJE (com boleto)',
    quando: 'Enviada pela SoFIA para a aluna com BOLETO em aberto que VENCE HOJE. Lembra que vence hoje e leva o boleto no {link}. Tem horário/dias PRÓPRIOS (independentes das outras cobranças), editáveis no card abaixo.',
    vars: [['nome', 'primeiro nome da aluna'], ['vencimento', 'data de vencimento (hoje), ex.: 07/10/2026'], ['link', 'link do boleto dela — mantenha o {link} no texto'], ['valor', 'valor do boleto, ex.: R$ 647,00 (opcional)']],
    padrao: 'Oi, {nome}! 💜 Passando pra lembrar que o boleto da sua mensalidade do {studio} *vence hoje* ({vencimento}).\n\nPara manter tudo em dia, segue o boleto:\n{link}\n\nSe já pagou, é só desconsiderar. Qualquer dúvida, é só me chamar! 😊',
  },
  {
    chave: 'cobranca_saldo',
    titulo: 'Cobrança — saldo devedor (sem boleto e sem cartão recorrente)',
    quando: 'Enviada pela SoFIA para a aluna com SALDO DEVEDOR vencido há X+ dias no EVO cujo contrato NÃO é recorrente e que não tem boleto (ex.: plano pago na recepção, por PIX). Não leva link — ponha no texto como pagar (ex.: a chave PIX). {valor} = soma das parcelas já vencidas. Mesmo disparo da Cobrança — recorrente.',
    vars: [['nome', 'primeiro nome da aluna'], ['valor', 'valor vencido, ex.: R$ 877,00'], ['vencimento', 'vencimento da parcela mais antiga em aberto, ex.: 01/10/2026']],
    padrao: 'Olá, {nome}! Tudo bem? 💜\n\nIdentificamos que ficou um valor de {valor} em aberto no seu plano do {studio}, com vencimento em {vencimento}.\n\nPara regularizar, é só responder por aqui que te passamos as formas de pagamento.\n\nSe já tiver pago, pode desconsiderar. Qualquer dúvida, é só me chamar! 😊',
  },
  {
    chave: 'cobranca_app_reativado',
    titulo: 'App — acesso reativado (depois do pagamento)',
    quando: 'Enviada pela SoFIA quando a aluna que teve o login do app bloqueado por inadimplência QUITA e o robô recria o acesso. O EVO recria com a senha PADRÃO (3 primeiras letras do nome, minúsculas + nascimento ddmmaaaa) — explique a regra no texto. Só sai com o Bloqueio do app LIGADO (aba Cobrança).',
    vars: [['nome', 'primeiro nome da aluna']],
    padrao: 'Oi, {nome}! 💜 Recebemos o seu pagamento, obrigada!\n\nSeu acesso ao app do {studio} foi reativado. Para entrar:\n• *Login:* o seu e-mail cadastrado\n• *Senha:* as 3 primeiras letras do seu nome, em minúsculas, + a sua data de nascimento (ddmmaaaa)\n\nExemplo: Julia, nascida em 15/01/2005 → *jul15012005*\n\nDepois de entrar, se quiser, é só trocar a senha no app. Qualquer dúvida, é só me chamar! 😊',
  },
];

const PADROES = Object.fromEntries(CATALOGO.map(m => [m.chave, m.padrao]));

// ── Leitura/escrita do arquivo de edições ──────────────────────────────────
function carregarOverrides() {
  try {
    const raw = fs.readFileSync(ARQUIVO, 'utf8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (_) {
    return {}; // sem arquivo (ou inválido) → usa só os padrões
  }
}

function salvarOverride(chave, texto) {
  if (!PADROES.hasOwnProperty(chave)) throw new Error('Mensagem desconhecida: ' + chave);
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const atual = carregarOverrides();
  const t = normalizar(texto);
  if (t.trim() === '' || t === PADROES[chave]) {
    delete atual[chave]; // vazio ou igual ao padrão → volta ao padrão
  } else {
    atual[chave] = t;
  }
  fs.writeFileSync(ARQUIVO, JSON.stringify(atual, null, 2), 'utf8');
  return atual[chave] || PADROES[chave];
}

// Normaliza quebras de linha: navegadores enviam \r\n em formulários; o \r
// solto pode virar caractere estranho no WhatsApp. Guardamos/enviamos só \n.
function normalizar(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n');
}

// Texto atual de uma chave (edição do painel, ou o padrão). Aplica a
// normalização de quebras de linha mesmo em edições antigas já salvas com \r\n.
function texto(chave) {
  const ov = carregarOverrides();
  return (ov[chave] != null && String(ov[chave]).trim() !== '') ? normalizar(ov[chave]) : PADROES[chave];
}

// Substitui {marcadores} pelos valores. As variáveis GLOBAIS (studio, saudacao,
// hoje, dia_semana) são resolvidas sozinhas; o que o job passar tem prioridade.
function render(chave, vars = {}) {
  let t = texto(chave);
  if (t == null) return '';
  const todos = Object.assign(globais(), vars);
  for (const [k, v] of Object.entries(todos)) {
    t = t.split('{' + k + '}').join(v == null ? '' : String(v));
  }
  return t;
}

// Variáveis GLOBAIS: valem em QUALQUER mensagem, preenchidas automaticamente na
// hora do envio a partir do relógio/ambiente (não dependem do job). Se um job
// passar o mesmo nome com um valor específico, o valor do job tem prioridade.
function globais() {
  const agora = new Date();
  const opt = { timeZone: 'America/Sao_Paulo' };
  const h = parseInt(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }), 10);
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return {
    studio: process.env.STUDIO_NOME || 'Studio SlimFit',
    saudacao,
    hoje: agora.toLocaleDateString('pt-BR', opt),
    dia_semana: agora.toLocaleDateString('pt-BR', Object.assign({ weekday: 'long' }, opt)),
  };
}
// Tags globais, para o painel listar como clicáveis em toda mensagem.
const GLOBAIS_TAGS = [
  ['saudacao', 'Bom dia / Boa tarde / Boa noite (conforme a hora)'],
  ['studio', 'nome do Studio'],
  ['hoje', 'data de hoje (ex.: 24/08/2026)'],
  ['dia_semana', 'dia da semana (ex.: segunda-feira)'],
];

// Valores de EXEMPLO para pré-visualizar/testar uma mensagem (o que a aluna
// veria). Usados no painel (pré-visualização) e no envio de teste.
const EXEMPLOS = {
  nome: 'Maria',
  horario: '09:00',
  professora: 'Tay',
  data: '30/08/2026',
  aluna: 'Maria',
  hora: '09h45',
  quando: 'sexta-feira, 28/08 às 16:15',
  contrato: 'COPA SLIM 2026 - C.C. - GRUPO 1',
  link: 'https://evo-totem.w12app.com.br/slimfit/15/site/checkout/EXEMPLO',
  vencimento: '25/09/2026',
  valor: 'R$ 199,00',
};
function exemplosCompletos() {
  return Object.assign(globais(), EXEMPLOS);
}
// Exemplos por MENSAGEM (override do EXEMPLOS global). Ex.: em 'aniversario' o
// {aluna} é uma @menção → no preview/teste mostramos "@Maria" (e não "Maria").
function exemplosDe(chave) {
  const item = (CATALOGO || []).find(m => m.chave === chave);
  return Object.assign({}, EXEMPLOS, (item && item.exemplos) || {});
}
// Mapa { chave: {overrides} } só das mensagens que têm exemplo próprio — o painel
// injeta no preview client-side.
function exemplosPorChave() {
  const o = {};
  for (const m of (CATALOGO || [])) if (m.exemplos) o[m.chave] = m.exemplos;
  return o;
}
// Substitui {marcadores} num TEXTO qualquer (não só numa chave do catálogo).
// Usado pelo envio de teste, que manda o texto que está na tela.
function renderTexto(texto, vars = {}) {
  let t = normalizar(texto);
  const todos = Object.assign(globais(), EXEMPLOS, vars);
  for (const [k, v] of Object.entries(todos)) {
    t = t.split('{' + k + '}').join(v == null ? '' : String(v));
  }
  return t;
}

// Para mensagens com @menção nativa: renderiza tudo, menos o marcador da
// menção, e devolve { antes, depois } quebrado nesse ponto.
function partes(chave, vars, tokenMencao) {
  const t = render(chave, vars); // tokenMencao fica como {token} (não passado em vars)
  const marca = '{' + tokenMencao + '}';
  const i = t.indexOf(marca);
  if (i < 0) return { antes: t, depois: '' };
  return { antes: t.slice(0, i), depois: t.slice(i + marca.length) };
}

// ── Foto opcional por mensagem (grupo/broadcast: Circuito, Aniversário) ──────
function fotoPath(chave) {
  for (const ext of ['jpg', 'png', 'webp']) {
    const p = path.join(FOTOS_DIR, chave + '.' + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function fotoNome(chave) { const p = fotoPath(chave); return p ? path.basename(p) : null; }
function removerFoto(chave) {
  for (const ext of ['jpg', 'png', 'webp']) {
    const p = path.join(FOTOS_DIR, chave + '.' + ext);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}
// Todas as mensagens de WhatsApp aceitam foto (flyer), MENOS as text-only:
//  • 'instagram' — DM do Instagram (canal diferente, tratado na aba Instagram);
//  • 'ausentes'  — listagem de texto no grupo da equipe (enviada sem mídia).
const SEM_FOTO = new Set(['confirmacao_sem_resposta_equipe', 'instagram', 'ausentes', 'aniversariantes_mes', 'renovacoes_mes', 'cobranca_recorrente', 'cobranca_boleto', 'cobranca_boleto_hoje', 'cobranca_saldo', 'cobranca_app_reativado']);
function aceitaFoto(chave) { const m = CATALOGO.find(x => x.chave === chave); return !!(m && !SEM_FOTO.has(m.chave)); }
// ── Pacote de imagens (exportar/importar entre unidades) ─────────────────────
// Um .json { tipo, versao, unidade, em, fotos: { <chave>: "data:image/...;base64,..." } }.
// O painel baixa o pacote de uma unidade e importa em outra. O MESMO formato fica
// no repositório (Experimental/padrao/mensagens-fotos.json) como imagens padrão de
// uma unidade NOVA.
const PACOTE_PADRAO = path.resolve(__dirname, '..', 'padrao', 'mensagens-fotos.json');
function exportarFotos(unidade) {
  const fotos = {};
  for (const m of CATALOGO) {
    if (!aceitaFoto(m.chave)) continue;
    const p = fotoPath(m.chave); if (!p) continue;
    const ext = path.extname(p).slice(1).toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    try { fotos[m.chave] = `data:${tipo};base64,` + fs.readFileSync(p).toString('base64'); } catch (_) {}
  }
  return { tipo: 'slimfit-mensagens-fotos', versao: 1, unidade: unidade || '', em: new Date().toISOString(), fotos };
}
// substituir=false: só preenche as mensagens que ainda NÃO têm imagem.
function importarFotos(pacote, { substituir = true } = {}) {
  const fotos = pacote && typeof pacote === 'object' ? (pacote.fotos || pacote) : null;
  if (!fotos || typeof fotos !== 'object') throw new Error('arquivo inválido (não é um pacote de imagens).');
  const r = { importadas: [], puladas: [], erros: [] };
  for (const [chave, dataUrl] of Object.entries(fotos)) {
    if (!aceitaFoto(chave)) { r.puladas.push(chave); continue; }
    if (!substituir && fotoPath(chave)) { r.puladas.push(chave); continue; }
    try { salvarFoto(chave, dataUrl); r.importadas.push(chave); } catch (e) { r.erros.push(`${chave}: ${e.message}`); }
  }
  return r;
}
// Unidade NOVA (sem data/mensagens-fotos): nasce com as imagens padrão do repo.
(function semearFotos() {
  try {
    if (fs.existsSync(FOTOS_DIR) || !fs.existsSync(PACOTE_PADRAO)) return;
    importarFotos(JSON.parse(fs.readFileSync(PACOTE_PADRAO, 'utf8')), { substituir: false });
  } catch (_) {}
})();

function salvarFoto(chave, dataUrl) {
  if (!aceitaFoto(chave)) throw new Error('Esta mensagem não aceita foto.');
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Imagem inválida (envie PNG, JPG ou WEBP).');
  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('Imagem muito grande (máx. ~6 MB).');
  removerFoto(chave); // troca a anterior (qualquer extensão)
  if (!fs.existsSync(FOTOS_DIR)) fs.mkdirSync(FOTOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(FOTOS_DIR, chave + '.' + ext), buf);
  return chave + '.' + ext;
}

// Para o painel: lista com título, descrição, variáveis, texto atual, padrão
// e se está editado.
function listar() {
  const ov = carregarOverrides();
  return CATALOGO.map(m => ({
    chave: m.chave,
    titulo: m.titulo,
    quando: m.quando,
    // vars do job + globais (sem duplicar as que o job já lista).
    vars: [...(m.vars || []), ...GLOBAIS_TAGS.filter(g => !(m.vars || []).some(v => v[0] === g[0]))],
    padrao: m.padrao,
    texto: (ov[m.chave] != null && String(ov[m.chave]).trim() !== '') ? ov[m.chave] : m.padrao,
    editado: ov[m.chave] != null && String(ov[m.chave]).trim() !== '' && ov[m.chave] !== m.padrao,
    aceitaFoto: aceitaFoto(m.chave),
    fotoNome: aceitaFoto(m.chave) ? fotoNome(m.chave) : null,
  }));
}

module.exports = {
  render, renderTexto, partes, texto, salvarOverride, listar, carregarOverrides,
  fotoPath, fotoNome, salvarFoto, removerFoto, aceitaFoto, FOTOS_DIR, exportarFotos, importarFotos,
  CATALOGO, PADROES, EXEMPLOS, exemplosCompletos, exemplosDe, exemplosPorChave, ARQUIVO,
};
