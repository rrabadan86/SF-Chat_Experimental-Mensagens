/**
 * tempo.js — datas e horas sem dependência externa.
 *
 * O Brasil não tem mais horário de verão desde 2019, então um deslocamento fixo
 * (-03:00) resolve. Se um dia voltar, é aqui que se mexe — e só aqui.
 */
const OFFSET = process.env.TZ_OFFSET || '-03:00';

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = (n) => String(n).padStart(2, '0');

/** '2026-08-25' + '08:00' -> '2026-08-25T08:00:00-03:00' (aceito pelo Google) */
function rfc3339(dataISO, hora, offset = OFFSET) {
  return `${dataISO}T${hora}:00${offset}`;
}

/** milissegundos de um par data+hora local */
function ms(dataISO, hora, offset = OFFSET) {
  return Date.parse(rfc3339(dataISO, hora, offset));
}

/** '08:00' -> 480 */
function emMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** 480 -> '08:00' */
function emHora(minutos) {
  return `${pad(Math.floor(minutos / 60))}:${pad(minutos % 60)}`;
}

/** dia da semana de uma data ISO, 0=domingo. Fixado no meio-dia UTC para não escorregar. */
function diaDaSemana(dataISO) {
  return new Date(`${dataISO}T12:00:00Z`).getUTCDay();
}

/** soma dias a uma data ISO, devolvendo outra data ISO */
function somarDias(dataISO, dias) {
  const d = new Date(`${dataISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** data de hoje no fuso configurado */
function hoje(agora = new Date(), offset = OFFSET) {
  const sinal = offset.startsWith('-') ? -1 : 1;
  const [oh, om] = offset.slice(1).split(':').map(Number);
  const deslocado = new Date(agora.getTime() + sinal * (oh * 60 + om) * 60000);
  return deslocado.toISOString().slice(0, 10);
}

/** '2026-08-25' -> 'ter, 25 de agosto de 2026' */
function porExtenso(dataISO) {
  const [a, m, d] = dataISO.split('-').map(Number);
  return `${DIAS_CURTOS[diaDaSemana(dataISO)]}, ${d} de ${MESES[m - 1]} de ${a}`;
}

/** '2026-08-25' -> 'ter, 25/08' */
function curta(dataISO) {
  const [, m, d] = dataISO.split('-');
  return `${DIAS_CURTOS[diaDaSemana(dataISO)]}, ${d}/${m}`;
}

/** '2026-08-25' -> '25/08/2026' */
function brasileira(dataISO) {
  const texto = String(dataISO || '');
  // já veio no formato brasileiro: devolver como está é melhor que produzir
  // "undefined/undefined/09/01/1986", que foi o que a recepção chegou a ver
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) return texto;
  const [a, m, d] = texto.split('-');
  return d && m && a ? `${d}/${m}/${a}` : texto;
}

/**
 * dd/mm/aaaa de volta para aaaa-mm-dd.
 *
 * O evento do Google guarda o nascimento já em português, para o médico ler.
 * Quem lê o evento de volta precisa desfazer isso, senão a data entra no
 * lugar do ISO e todo cálculo em cima dela falha calado.
 */
function deBrasileira(texto) {
  const m = String(texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(texto || '');
}

/** idade em anos completos na data de referência */
function idade(nascimentoISO, refISO) {
  if (!nascimentoISO) return null;
  const [na, nm, nd] = nascimentoISO.split('-').map(Number);
  const [ra, rm, rd] = refISO.split('-').map(Number);
  let anos = ra - na;
  if (rm < nm || (rm === nm && rd < nd)) anos--;
  return anos >= 0 && anos < 130 ? anos : null;
}

module.exports = {
  OFFSET, DIAS_CURTOS, MESES,
  pad, rfc3339, ms, emMinutos, emHora, diaDaSemana, somarDias, hoje,
  porExtenso, curta, brasileira, deBrasileira, idade,
};
