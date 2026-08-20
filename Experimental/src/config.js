require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

// Nome do Studio como aparece nas mensagens para a aluna. Cada franquia define o
// seu no .env (STUDIO_NOME); o padrão mantém a unidade original funcionando igual.
const STUDIO_NOME = process.env.STUDIO_NOME || 'Studio Slimfit Setor Bueno';

// Mapa professora → arquivo de áudio (pós-aula). O padrão é o da unidade original.
// Cada franquia pode sobrescrever no .env com AUDIO_MAP (um JSON), ex.:
//   AUDIO_MAP={"ana":"A-Ana-Pos","carla":"A-Carla-Pos"}
function mapaAudioPadrao() {
  return {
    taynara: 'A-Tay-Pós',
    luiza:   'A-Luiza-Pós',
    raissa:  'A-Raissa-Pós',
    beatriz: 'A-Bia-Pós',
    bia:     'A-Bia-Pós',
  };
}
function mapaAudio() {
  if (process.env.AUDIO_MAP) {
    try {
      return JSON.parse(process.env.AUDIO_MAP);
    } catch (e) {
      console.warn('⚠️  AUDIO_MAP inválido no .env (usando o mapa padrão):', e.message);
    }
  }
  return mapaAudioPadrao();
}

const config = {
  evo: {
    url: process.env.EVO_URL || 'https://slimfit.w12app.com.br',
    email: process.env.EVO_EMAIL,
    password: process.env.EVO_PASSWORD,
    loginPath: process.env.EVO_LOGIN_PATH || '#/acesso/slimfit/autenticacao',
    experimentalPath: process.env.EVO_EXPERIMENTAL_PATH || '#/app/slimfit/15/gerencial/aula-experimental',
  },

  puppeteer: {
    headless: process.env.HEADLESS !== 'false',
  },

  // Mensagem para aulas de HOJE (enviada às 08:30)
  messagesToday: (nome, horario) =>
    `Olá, ${nome}! 😊\n\nTudo bem? Aqui é do ${STUDIO_NOME}!\n\nEstamos mandando essa mensagem para confirmar a sua aula experimental de logo mais que está agendada para hoje às ${horario}.\n\nPode confirmar sua presença? Estamos te esperando! 💪`,

  // Mensagem para aulas de AMANHÃ (enviada às 16:30)
  messagesTomorrow: (nome, horario) =>
    `Olá, ${nome}! 😊\n\nTudo bem? Aqui é do ${STUDIO_NOME}!\n\nEstamos mandando essa mensagem para confirmar a sua aula experimental que está agendada para amanhã às ${horario}.\n\nPode confirmar sua presença? Estamos te esperando! 💪`,

  // Mensagem de follow-up pós aula experimental — para quem AINDA NÃO fechou
  messageFollowup: (nomeProfessora) =>
    `Oie! Tudo bem?\n\nSegue áudio que a professora ${nomeProfessora} fez sobre a sua aula experimental! =)\n\nSei que a primeira aula sempre é mais difícil, principalmente por ser uma metodologia nova!\n\nMas agora que você já deu o primeiro passo 👏, o que acha de vir para mais uma aula e darmos andamento da sua matrícula?\n\nTe aguardo!!! 🥰`,

  // Mensagem de no-show (faltou na aula experimental) — convida a remarcar
  messageNoShow: (nome, horario) =>
    `Oi, ${nome}! 😊 Tudo bem?\n\nNotamos que você não conseguiu comparecer à sua aula experimental de hoje${horario ? ` (${horario})` : ''}. Acontece! 💛\n\nQue tal remarcar? Vai ser um prazer te receber. É só me responder por aqui que a gente encontra um novo horário pra você! 🙌`,

  // Mensagem de follow-up para quem JÁ VIROU ALUNA (contrato preenchido)
  messageFollowupAluna: (nomeProfessora) =>
    `Oie! Tudo bem?\n\nQue alegria ter você com a gente! 🥰\n\nSegue um áudio que a professora ${nomeProfessora} preparou sobre a sua aula!\n\nSeja muito bem-vinda ao SlimFit! 💪\n\nEstamos muito felizes com a sua decisão. Qualquer dúvida que tiver sobre o APP pode me acionar!\n\nConte conosco! ❤️`,

  // Áudios de follow-up (pasta e mapeamento professora → arquivo)
  audio: {
    dir: process.env.AUDIO_DIR || require('path').resolve(__dirname, '..', 'audios'),
    map: mapaAudio(),
  },

  // Cron schedules
  schedule: {
    morning:          '30 8 * * 1-6',   // 08:30 seg-sáb (confirmação hoje)
    afternoon:        '30 15 * * 0-5',  // 15:30 dom-sex (confirmação amanhã)
    renewal:          '30 14 * * *',    // 14:30 todos os dias (renovação: avisa quem vence em exatos 7 dias)
    followupMorning:  '30 10 * * 1-6',  // 10:30 seg-sáb (follow-up ontem manhã)
    followupAfternoon:'0 16 * * 1-6',   // 16:00 seg-sáb (follow-up ontem tarde)
    instagram:        '0 7 * * *',      // 07:00 todos os dias (boas-vindas novos seguidores)
    aniversariantes:  '0 8 * * *',      // 08:00 todos os dias (parabéns nos grupos)
    planilhaAniv:     '0 14 * * *',     // 14:00 todos os dias (planilha de alunas + aniversários)
    aniversMesGrupo:  '30 5 28 * *',    // 05:30 todo dia 28 (lista de aniversariantes do mês no grupo da equipe)
    presentesPend:    '45 6 * * 1',     // 06:45 toda segunda (presentes de tempo de casa pendentes no grupo)
    resumoSemana:     '30 16 * * 5',    // 16:30 toda sexta (resumo da semana no grupo da equipe)
    ausentes10:       '10 6 * * 1',     // 06:10 toda segunda (alunas ausentes >10 dias no grupo da equipe)
    resumoDia:        '45 19 * * *',    // 19:45 todos os dias (resumo do dia das experimentais no grupo)
    noShowMorning:    '30 11 * * 1-6',  // 11:30 seg-sáb (faltas nas aulas da manhã → remarcar)
    noShowAfternoon:  '30 19 * * 1-6',  // 19:30 seg-sáb (faltas nas aulas da tarde/noite → remarcar)
  },

  // Filtros de horário
  filters: {
    morning: { minTime: '12:00', maxTime: '23:59' },    // Hoje após 12h
    afternoon: { minTime: '00:00', maxTime: '11:30' },   // Amanhã até 11:30
  },
};

module.exports = config;
