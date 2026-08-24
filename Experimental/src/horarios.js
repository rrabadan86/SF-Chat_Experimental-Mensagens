/**
 * Cofre dos HORÁRIOS editáveis dos jobs (hora + dias da semana).
 *
 * Os padrões vivem no config.js (schedule). As edições feitas no painel ficam
 * em data/horarios.json e têm prioridade. O config.js aplica os overrides ao
 * carregar; como o robô agenda tudo no boot, uma mudança vale após reiniciar o
 * robô (o painel faz isso com um botão).
 *
 * Só jobs "hora H, minuto M, em certos dias da semana" (cron: M H * * DOW).
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'horarios.json');

// chave = mesma do config.schedule. padrao = cron atual do config.
const CATALOGO = [
  { chave: 'morning',           titulo: 'Confirmação — aula de hoje',   padrao: '30 8 * * 1-6' },
  { chave: 'afternoon',         titulo: 'Confirmação — aula de amanhã', padrao: '30 15 * * 0-5' },
  { chave: 'followupMorning',   titulo: 'Follow-up pós-aula (manhã)',   padrao: '30 10 * * 1-6' },
  { chave: 'followupAfternoon', titulo: 'Follow-up pós-aula (tarde)',   padrao: '0 16 * * 1-6' },
  { chave: 'noShowMorning',     titulo: 'Faltou / no-show (manhã)',     padrao: '30 11 * * 1-6' },
  { chave: 'noShowAfternoon',   titulo: 'Faltou / no-show (tarde)',     padrao: '30 19 * * 1-6' },
  { chave: 'renewal',           titulo: 'Renovação de contrato',        padrao: '30 14 * * *' },
  { chave: 'aniversariantes',   titulo: 'Aniversário (nos grupos)',     padrao: '0 8 * * *' },
  { chave: 'instagram',         titulo: 'Boas-vindas no Instagram',     padrao: '0 7 * * *' },
  { chave: 'circuitoConvoca',   titulo: 'Circuito — convocatória',      padrao: '15 16 * * 3' },
  { chave: 'circuitoLembrete',  titulo: 'Circuito — lembrete',          padrao: '15 16 * * 5' },
  { chave: 'resumoDia',         titulo: 'Resumo do dia (equipe)',       padrao: '45 19 * * *' },
  { chave: 'resumoSemana',      titulo: 'Resumo da semana (equipe)',    padrao: '30 16 * * 5' },
  { chave: 'agendadosManha',    titulo: 'Envios agendados — manhã',     padrao: '45 10 * * *' },
  { chave: 'agendadosTarde',    titulo: 'Envios agendados — tarde',     padrao: '45 15 * * *' },
];
const PADROES = Object.fromEntries(CATALOGO.map(j => [j.chave, j.padrao]));

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvarMapa(m) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(m, null, 2), 'utf8');
}

// cron atual de uma chave (override ou padrão informado/embutido).
function cronDe(chave, padrao) {
  const o = carregar();
  return o[chave] || padrao || PADROES[chave];
}

// ── conversão cron (M H * * DOW) ↔ { hora:'HH:MM', dias:[0..6] } ──
function parseDow(field) {
  if (!field || field === '*') return [0, 1, 2, 3, 4, 5, 6];
  const dias = new Set();
  for (const part of String(field).split(',')) {
    const m = part.match(/^(\d)-(\d)$/);
    if (m) { for (let d = +m[1]; d <= +m[2]; d++) dias.add(((d % 7) + 7) % 7); }
    else if (/^\d$/.test(part)) dias.add(+part);
  }
  return [...dias].sort((a, b) => a - b);
}
function parse(cron) {
  const p = String(cron || '').trim().split(/\s+/);
  const min = parseInt(p[0], 10) || 0;
  const hora = parseInt(p[1], 10) || 0;
  return { hora: String(hora).padStart(2, '0') + ':' + String(min).padStart(2, '0'), dias: parseDow(p[4]) };
}
function build(horaStr, dias) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(horaStr || ''));
  if (!m) throw new Error('Horário inválido (use HH:MM).');
  const h = +m[1], mi = +m[2];
  if (h < 0 || h > 23 || mi < 0 || mi > 59) throw new Error('Horário fora do intervalo (00:00–23:59).');
  const ds = [...new Set((dias || []).map(Number).filter(d => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (ds.length === 0) throw new Error('Escolha pelo menos um dia da semana.');
  const dow = ds.length === 7 ? '*' : ds.join(',');
  return `${mi} ${h} * * ${dow}`;
}

// Forma normalizada de um cron (mesma saída de build), p/ comparar sem depender
// de "1-6" vs "1,2,3,4,5,6" — os dois representam os mesmos dias.
function normalizarCron(cron) {
  const info = parse(cron);
  return build(info.hora, info.dias);
}

// Salva o horário de uma chave (valida antes). Vazio/igual ao padrão → remove override.
function salvar(chave, horaStr, dias) {
  if (!PADROES.hasOwnProperty(chave)) throw new Error('Job desconhecido: ' + chave);
  const cron = build(horaStr, dias);
  const m = carregar();
  if (cron === normalizarCron(PADROES[chave])) delete m[chave]; else m[chave] = cron;
  salvarMapa(m);
  return cron;
}

function listar() {
  const o = carregar();
  return CATALOGO.map(j => {
    const cron = o[j.chave] || j.padrao;
    const info = parse(cron);
    return { chave: j.chave, titulo: j.titulo, cron, padrao: j.padrao, editado: !!o[j.chave] && o[j.chave] !== j.padrao, hora: info.hora, dias: info.dias };
  });
}

module.exports = { CATALOGO, PADROES, cronDe, parse, build, salvar, listar, carregar, ARQUIVO };
