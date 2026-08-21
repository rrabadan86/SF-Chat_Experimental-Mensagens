/**
 * Dispara os ENVIOS AGENDADOS (do painel) do dia + turno atual.
 *
 * O scheduler chama runAgendados('manha') às 10:45 e runAgendados('tarde')
 * às 15:45. Usa a conexão persistente do WhatsApp (wa-client). Envia texto,
 * ou foto com a mensagem de legenda; marca cada item como enviado/falha.
 *
 * Uso manual:
 *   node src/enviar-agendados.js --turno=manha            # dry (só lista)
 *   node src/enviar-agendados.js --turno=tarde --enviar   # envia de verdade
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const ag = require('./agendamentos');
const notif = require('./notificar');

// Intervalo (aleatório) entre um envio e o próximo — evita disparar tudo de uma
// vez (o WhatsApp pode marcar como spam). Configurável no .env, em segundos:
//   AGENDADOS_INTERVALO_MIN=20   AGENDADOS_INTERVALO_MAX=40
const INTERVALO_MIN = parseInt(process.env.AGENDADOS_INTERVALO_MIN || '20', 10);
const INTERVALO_MAX = parseInt(process.env.AGENDADOS_INTERVALO_MAX || '40', 10);
function intervaloMs() {
  const lo = Math.max(0, Math.min(INTERVALO_MIN, INTERVALO_MAX));
  const hi = Math.max(INTERVALO_MIN, INTERVALO_MAX);
  return Math.round((lo + Math.random() * (hi - lo)) * 1000);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Data de hoje em America/Sao_Paulo, no formato YYYY-MM-DD (igual ao <input date>).
function hojeSP() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

async function runAgendados(turno, { dry = false } = {}) {
  const data = hojeSP();
  const pend = ag.pendentesDe(data, turno);
  console.log(`\n📅 Envios agendados — ${turno} (${data}): ${pend.length} pendente(s).`);
  if (pend.length === 0) return { enviados: 0, falhas: 0 };

  const wa = require('./wa-client');
  let ok = 0, fail = 0;
  for (let i = 0; i < pend.length; i++) {
    const item = pend[i];
    const resumo = (item.mensagem || '(sem texto)').replace(/\n/g, ' ').slice(0, 50);
    console.log(`   → ${item.telefone}${item.foto ? ' [foto]' : ''}: ${resumo}`);
    if (dry) continue;
    try {
      if (item.foto) {
        const caminho = ag.caminhoFoto(item.foto);
        if (!caminho) throw new Error('arquivo de foto inválido');
        await wa.sendMidia(item.telefone, caminho, { legenda: item.mensagem || '' });
      } else {
        await wa.sendTexto(item.telefone, item.mensagem);
      }
      ag.marcar(item.id, 'enviado');
      ok++; console.log('     ✅ enviado');
    } catch (e) {
      ag.marcar(item.id, 'falha', e.message);
      fail++; console.log('     ❌ falha:', e.message);
    }
    // Respiro aleatório antes do PRÓXIMO envio (não espera depois do último).
    if (!dry && i < pend.length - 1) {
      const ms = intervaloMs();
      console.log(`     ⏳ aguardando ${(ms / 1000).toFixed(0)}s até o próximo…`);
      await sleep(ms);
    }
  }
  console.log(`   Resultado: ${ok} enviado(s), ${fail} falha(s).`);
  if (fail > 0) {
    notif.alertar('Agendados: falha no envio',
      `${fail} de ${pend.length} envio(s) agendado(s) do turno ${turno} (${data}) falharam. Confira no painel.`,
      { tags: 'warning' });
  }
  return { enviados: ok, falhas: fail };
}

module.exports = { runAgendados, hojeSP };

// ─── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const turno = (args.find(a => a.startsWith('--turno=')) || '').split('=')[1] || 'manha';
  const dry = !args.includes('--enviar');
  if (!ag.TURNOS.includes(turno)) { console.error('Turno inválido (use --turno=manha ou --turno=tarde).'); process.exit(1); }
  (async () => {
    try {
      if (!dry) await require('./wa-client').initWhatsApp();
      await runAgendados(turno, { dry });
      if (dry) console.log('\n🧪 DRY — nada enviado. Use --enviar para disparar.');
    } catch (e) {
      console.error('❌ erro:', e.message);
    } finally {
      if (!dry) { try { await require('./wa-client').destroy(); } catch (_) {} }
      process.exit(0);
    }
  })();
}
