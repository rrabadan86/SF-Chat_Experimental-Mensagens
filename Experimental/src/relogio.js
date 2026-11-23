/**
 * relogio.js — o "agora" e o "hoje" do sistema, no horário de Brasília. Fonte única.
 *
 * Em teste (NODE_ENV=test) dá para FIXAR o agora com SF_AGORA (data/hora ISO, ex.:
 * "2027-01-01T08:30:00-03:00") e conferir datas difíceis (1º do mês, fim do mês,
 * 1º de janeiro, domingo). Fora de teste SF_AGORA é ignorado: em produção o relógio
 * é sempre o de verdade.
 */
const TZ = 'America/Sao_Paulo';

function agora() {
  if (process.env.NODE_ENV === 'test' && process.env.SF_AGORA) {
    const t = Date.parse(process.env.SF_AGORA);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}
// 'AAAA-MM-DD' de hoje em Brasília; desloc = dias a somar (1 = amanhã, -1 = ontem).
function hojeSP(desloc = 0) {
  return new Date(agora() + desloc * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
}
// Dia da semana (0 = domingo) de uma data 'AAAA-MM-DD'.
function diaSemana(iso) { return new Date(String(iso) + 'T12:00:00Z').getUTCDay(); }
// Hora (0–23) em Brasília.
function horaSP(ms = agora()) { return parseInt(new Date(ms).toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }), 10) % 24; }

module.exports = { TZ, agora, hojeSP, diaSemana, horaSP };
