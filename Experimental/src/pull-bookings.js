/**
 * pull-bookings.js — puxa o LOG COMPLETO de agendamentos do formulário (Render) e
 * o persiste no VPS (data/bookings.json via bookings.js). Roda a cada ~2 min pelo
 * scheduler. Best-effort: nunca derruba nada.
 *
 * Reaproveita a mesma config da ponte de confirmações:
 *   FORM_CLOUD_URL     = https://sf-formularioexperimental.onrender.com
 *   FORM_OUTBOX_TOKEN  = <o MESMO token do Render>
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const bookings = require('./bookings');

const CLOUD_URL = (process.env.FORM_CLOUD_URL || 'https://sf-formularioexperimental.onrender.com').replace(/\/+$/, '');
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

  const add = bookings.registrar(rows);

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
