require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

// Cofre central de textos editáveis (padrão + edições do painel em data/mensagens.json).
const mensagens = require('./mensagens');

// Nome do Studio como aparece nas mensagens para a aluna. Cada franquia define o
// seu no .env (STUDIO_NOME); o padrão mantém a unidade original funcionando igual.
const STUDIO_NOME = process.env.STUDIO_NOME || 'Studio SlimFit';

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

  // As mensagens abaixo vêm do cofre central (src/mensagens.js), que aplica as
  // edições feitas no painel (data/mensagens.json) e, se não houver edição, usa
  // o texto padrão. Editar no painel vale já no próximo envio, sem reiniciar.

  // Mensagem para aulas de HOJE (enviada às 08:30). `aula` traz os campos da
  // turma (professor, date…) para as variáveis {professora} e {data}.
  messagesToday: (nome, horario, aula = {}) => mensagens.render('confirmacao_hoje', { nome, horario, professora: aula.professor || '', data: aula.date || '' }),

  // Mensagem para aulas de AMANHÃ (enviada às 15:30)
  messagesTomorrow: (nome, horario, aula = {}) => mensagens.render('confirmacao_amanha', { nome, horario, professora: aula.professor || '', data: aula.date || '' }),

  // Mensagem de follow-up pós aula experimental — para quem AINDA NÃO fechou
  messageFollowup: (nomeProfessora) => mensagens.render('followup', { professora: nomeProfessora }),

  // Mensagem de no-show (faltou na aula experimental) — convida a remarcar
  messageNoShow: (nome, horario) => mensagens.render('no_show', { nome, horario: horario ? ` (${horario})` : '' }),

  // Mensagem de follow-up para quem JÁ VIROU ALUNA (contrato preenchido)
  messageFollowupAluna: (nomeProfessora) => mensagens.render('followup_aluna', { professora: nomeProfessora }),

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
    slotsPush:        '*/10 * * * *',   // a cada 10 min, 24h (calcula a grade e envia ao formulário)
    circuitoConvoca:  '15 16 * * 3',    // 16:15 quarta (convocatória do Circuito de sábado, com a professora)
    circuitoLembrete: '15 16 * * 5',    // 16:15 sexta ("é amanhã!" no grupo Circuito Slim)
    agendadosManha:   '45 10 * * *',    // 10:45 todos os dias (envios agendados no painel — turno manhã)
    agendadosTarde:   '45 15 * * *',    // 15:45 todos os dias (envios agendados no painel — turno tarde)
    comparecimento:   '0 16 * * 6',     // 16:00 sábado (cruza presença da semana no EVO → troca tags)
  },

  // Filtros de horário
  filters: {
    morning: { minTime: '12:00', maxTime: '23:59' },    // Hoje após 12h
    afternoon: { minTime: '00:00', maxTime: '11:30' },   // Amanhã até 11:30
  },
};

// Aplica os horários editados no painel (data/horarios.json) por cima dos
// padrões acima. Só afeta as chaves editáveis (as demais ficam intactas).
try {
  const horarios = require('./horarios');
  for (const k of Object.keys(config.schedule)) {
    config.schedule[k] = horarios.cronDe(k, config.schedule[k]);
  }
} catch (_) { /* sem overrides → usa os padrões */ }

// Nome do Studio (para banners/logs). Vem do .env (STUDIO_NOME); cada unidade
// define o seu, então os logs mostram o nome certo — nada de "Bueno" fixo.
config.STUDIO_NOME = STUDIO_NOME;

module.exports = config;
