/**
 * pull-indicadores.js — puxa os eventos de indicadores do formulário (Render) e
 * os persiste no VPS (data/indicadores.json via indicadores.js). Roda a cada
 * ~2 min pelo scheduler. Best-effort: nunca derruba nada.
 *
 * Reaproveita a mesma config da ponte de confirmações:
 *   FORM_CLOUD_URL     = https://sf-formularioexperimental.onrender.com
 *   FORM_OUTBOX_TOKEN  = <o MESMO token do Render>
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const indicadores = require('./indicadores');

const CLOUD_URL = (process.env.FORM_CLOUD_URL || 'https://sf-formularioexperimental.onrender.com').replace(/\/+$/, '');
const TOKEN = process.env.FORM_OUTBOX_TOKEN || '';

async function pullIndicadores() {
  if (!TOKEN) { console.log('[indicadores] FORM_OUTBOX_TOKEN não definido — pull ignorado.'); return { add: 0 }; }
  let eventos = [];
  try {
    const r = await fetch(`${CLOUD_URL}/api/ind/pending?token=${encodeURIComponent(TOKEN)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.log(`[indicadores] pending HTTP ${r.status}`); return { add: 0 }; }
    const j = await r.json();
    eventos = (j && j.eventos) || [];
  } catch (e) { console.log('[indicadores] falha ao puxar:', e && e.message); return { add: 0 }; }

  if (eventos.length === 0) return { add: 0 };

  const add = indicadores.registrar(eventos);

  // Confirma o recebimento para o formulário apagar os eventos entregues.
  try {
    const ids = eventos.map(e => e.id).filter(Boolean);
    await fetch(`${CLOUD_URL}/api/ind/ack?token=${encodeURIComponent(TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) { console.log('[indicadores] ack falhou (repuxa no próximo ciclo):', e && e.message); }

  console.log(`[indicadores] +${add} evento(s) de ${eventos.length} recebido(s).`);
  return { add };
}

module.exports = { pullIndicadores };

if (require.main === module) {
  pullIndicadores().then(r => { console.log('ok', r); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
