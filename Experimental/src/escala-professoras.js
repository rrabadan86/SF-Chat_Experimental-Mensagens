// escala-professoras.js
// Mapeia DIA DA SEMANA + HORÁRIO -> professora (e o áudio de follow-up dela).
// A grade de SEGUNDA a SEXTA é fixa. SÁBADO é escala (varia) -> retorna null,
// e o follow-up usa a professora lida da tabela do EVO (fallback).
//
// Dia da semana = Date.getDay(): 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb.

const ESCALA = {
  // Taynara — A-Tay-Pós
  taynara: {
    nome: 'Taynara',
    audio: 'A-Tay-Pós',
    slots: {
      1: ['05:45', '07:00', '08:15'],   // seg
      3: ['05:45', '07:00', '08:15'],   // qua
      5: ['05:45', '07:00', '08:15'],   // sex
      2: ['16:30'],                     // ter
      4: ['16:30'],                     // qui
    },
  },
  // Luiza — A-Luiza-Pós
  luiza: {
    nome: 'Luiza',
    audio: 'A-Luiza-Pós',
    slots: {
      2: ['07:00', '08:15', '09:30'],   // ter
      4: ['07:00', '08:15', '09:30'],   // qui
      3: ['09:30'],                     // qua
      5: ['09:30'],                     // sex
    },
  },
  // Bia — A-Bia-Pós
  bia: {
    nome: 'Bia',
    audio: 'A-Bia-Pós',
    slots: {
      2: ['18:15', '19:30'],            // ter
      4: ['18:15', '19:30'],            // qui
    },
  },
  // Raissa — A-Raissa-Pós
  raissa: {
    nome: 'Raissa',
    audio: 'A-Raissa-Pós',
    slots: {
      1: ['14:00', '16:15'],            // seg
      3: ['14:00', '16:15'],            // qua
      5: ['14:00', '16:15'],            // sex
    },
  },
};

// Normaliza "14h", "14:00", "9h30", "05h45" -> "HH:MM"
function normHora(t) {
  if (!t) return '';
  const m = String(t).match(/(\d{1,2})[:hH]?(\d{2})?/);
  if (!m) return String(t).trim();
  const hh = String(m[1]).padStart(2, '0');
  const mm = String(m[2] || '00').padStart(2, '0');
  return `${hh}:${mm}`;
}

// Descobre o dia da semana (0-6) a partir de uma data "DD/MM/YYYY" (ou Date).
function diaDaSemana(dateStr) {
  if (dateStr instanceof Date) return dateStr.getDay();
  const m = String(dateStr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])).getDay();
}

/**
 * Retorna o PREFIXO do áudio da professora fixa daquele dia+horário.
 * Retorna null quando não há regra fixa (ex.: SÁBADO) -> o chamador deve usar
 * a professora lida da tabela como fallback.
 *   dow  = dia da semana (0-6). Se vier uma string "DD/MM/YYYY", é convertida.
 *   time = "HH:MM" (aceita "14h", "9h30", etc.).
 */
// Retorna { nome, audio } da professora fixa daquele dia+horário, ou null
// quando não há regra fixa (ex.: SÁBADO) -> o chamador usa a professora da tabela.
function professoraPorEscala(dow, time) {
  if (typeof dow === 'string') dow = diaDaSemana(dow);
  if (dow === 6 || dow === 0 || dow == null) return null;   // sábado/domingo -> fallback
  const hhmm = normHora(time);
  for (const prof of Object.values(ESCALA)) {
    const horarios = (prof.slots[dow] || []).map(normHora);
    if (horarios.includes(hhmm)) return { nome: prof.nome, audio: prof.audio };
  }
  return null;
}

// Só o prefixo do áudio (compatibilidade).
function audioPorEscala(dow, time) {
  const p = professoraPorEscala(dow, time);
  return p ? p.audio : null;
}

module.exports = { professoraPorEscala, audioPorEscala, normHora, diaDaSemana, ESCALA };
