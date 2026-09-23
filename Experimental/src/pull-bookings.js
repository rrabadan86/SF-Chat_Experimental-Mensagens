/**
 * pull-bookings.js — puxa o LOG COMPLETO de agendamentos do formulário (Render) e
 * o persiste no VPS (data/bookings.json via bookings.js). Roda a cada ~2 min pelo
 * scheduler. Best-effort: nunca derruba nada.
 *
 * Reaproveita a mesma config da ponte de confirmações:
 *   FORM_CLOUD_URL     = https://SEU-PAINEL.duckdns.org/agendamentoexperimental
 *   FORM_OUTBOX_TOKEN  = <o MESMO token do Render>
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const bookings = require('./bookings');
const sofia = require('./sofia-editor'); // p/ avisar o Studio dos agendamentos do formulário

const CLOUD_URL = (process.env.FORM_CLOUD_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.FORM_OUTBOX_TOKEN || '';

async function pullBookings() {
  if (!TOKEN) { console.log('[bookings] FORM_OUTBOX_TOKEN não definido — pull ignorado.'); return { add: 0 }; }
  let rows = [];
  try {
    const r = await fetch(`${CLOUD_URL}/api/bookings/pending?token=${encodeURIComponent(TOKEN)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.log(`[bookings] pending HTTP ${r.status}`); return { add: 0 }; }
    const j = await r.json();
    rows = (j && j.rows) || [];
  } catch (e) { console.log('[bookings] falha ao puxar:', e && e.message); return { add: 0 }; }

  if (rows.length === 0) return { add: 0 };

  // Quais são NOVOS (ainda não registrados) — para avisar o Studio só UMA vez.
  let existentes = new Set();
  try { existentes = new Set(bookings.carregar().map(r => r.id)); } catch (_) {}
  const novas = rows.filter(r => r && r.id && !existentes.has(r.id));

  const add = bookings.registrar(rows);

  // Aviso "Nova aula experimental agendada" para o Studio + tag "agendou" nos
  // agendamentos vindos do FORMULÁRIO PÚBLICO. A SoFIA e o Cadastro Express já
  // avisam pelos próprios caminhos (chegam aqui com origem "sofia") → pulamos,
  // para o Studio não receber aviso em dobro. O painel consome o feed e envia.
  try {
    for (const r of novas) {
      if (String(r.origem || '').toLowerCase() === 'sofia') continue; // SoFIA/Express: já avisado
      const tel = String(r.telefone || '').replace(/\D/g, '');
      if (!tel) continue;
      sofia.registrarAgendou({ telefone: tel, nome: r.nome || '', when: r.when || '', canal: 'formulario' });
    }
  } catch (e) { console.log('[bookings] aviso ao Studio pulado:', e && e.message); }

  // Confirma o recebimento para o formulário apagar os registros entregues.
  try {
    const ids = rows.map(r => r.id).filter(Boolean);
    await fetch(`${CLOUD_URL}/api/bookings/ack?token=${encodeURIComponent(TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) { console.log('[bookings] ack falhou (repuxa no próximo ciclo):', e && e.message); }

  console.log(`[bookings] +${add} agendamento(s) de ${rows.length} recebido(s).`);
  return { add };
}

module.exports = { pullBookings };

if (require.main === module) {
  pullBookings().then(r => { console.log('ok', r); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
