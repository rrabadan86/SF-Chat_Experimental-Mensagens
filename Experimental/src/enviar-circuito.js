/**
 * Convocatória do CIRCUITO no grupo do WhatsApp "Circuito Slim".
 *
 *  • Quarta 16:15 → convocatória (busca a professora do Circuito de sábado na
 *                   Grade > Horários e monta a mensagem com o nome dela).
 *  • Sexta  16:15 → lembrete "É amanhã!" (mensagem fixa).
 *
 * Uso manual:
 *   node src/enviar-circuito.js --convocacao --dry     # lê a professora e imprime (não envia)
 *   node src/enviar-circuito.js --convocacao --enviar  # envia no grupo
 *   node src/enviar-circuito.js --lembrete --dry
 *   node src/enviar-circuito.js --lembrete --enviar
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const EvoScraper = require('./evo-scraper');
const config = require('./config');
const notif = require('./notificar');

const GRUPO = process.env.CIRCUITO_GRUPO || 'Circuito Slim';
const HORA_ALVO = process.env.CIRCUITO_HORA || '09:45';       // horário do Circuito de sábado
const CHAVE = (process.env.CIRCUITO_ATIVIDADE || 'circuito').toLowerCase(); // atividade a procurar

// ─── Mensagens (texto exato) ──────────────────────────────────────────────
function msgConvocacao(professora) {
  return `🔥 SÁBADO É DIA DE QUEIMAR CALORIAS NO CIRCUITO! 🔥\n`
    + `⚡️Comandada pela professora ${professora}.\n\n`
    + `Checkin Aberto!!!\n\n`
    + `⏰ Sábado às 09h45`;
}
const MSG_LEMBRETE =
  `🔥 *É AMANHÃ!* 🔥\n`
  + `⚡️ Estamos esperando todas vocês!\n\n`
  + `⏰ Sábado às 09h45`;

// ─── Busca a professora do Circuito na Grade > Horários (visão SEMANA) ─────
async function buscarProfessora(scraper) {
  const base = scraper.appOrigin || config.evo.url;
  const url = `${base}/#/app/slimfit/15/grade/horarios`;
  await scraper.page.goto(url, { waitUntil: 'networkidle2' });
  await scraper.sleep(5000);
  if (await scraper.isOnLoginPage()) {
    await scraper.login();
    await scraper.page.goto(url, { waitUntil: 'networkidle2' });
    await scraper.sleep(5000);
  }
  await scraper.dismissSurveyModal();
  await scraper.sleep(1500);

  // Garante a visão SEMANA (mostra o sábado da semana atual).
  await scraper.page.evaluate(() => {
    for (const el of document.querySelectorAll('button,a,span,div,li')) {
      if ((el.textContent || '').trim().toUpperCase() === 'SEMANA' && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
        (el.closest('button,a,[role="button"],li') || el).click();
        return;
      }
    }
  });
  await scraper.sleep(3500);

  const res = await scraper.page.evaluate((alvoHora, chave) => {
    const cards = [];
    for (const el of document.querySelectorAll('div,td,li,a')) {
      const t = (el.innerText || '').trim();
      if (!t.toLowerCase().includes(chave)) continue;
      if (el.children.length > 10) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.width > 500 || r.height <= 0) continue;
      const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
      const ai = lines.findIndex(l => l.toLowerCase().includes(chave)); // linha da atividade
      if (ai < 0) continue;
      // professora = 1ª linha após a atividade que não seja horário/ocupação/número
      let prof = '';
      for (let j = ai + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/\d{1,2}:\d{2}/.test(l) || /^\d+\s*\/\s*\d+$/.test(l) || /^\d+$/.test(l)) continue;
        prof = l; break;
      }
      cards.push({ prof, temHora: lines.some(l => l.includes(alvoHora)), x: Math.round(r.left), raw: lines.join(' | ') });
    }
    if (cards.length === 0) return null;
    let cand = cards.filter(c => c.temHora);      // prefere o card do horário-alvo (09:45)
    if (cand.length === 0) cand = cards;
    cand.sort((a, b) => b.x - a.x);               // sábado é a última coluna (mais à direita)
    return { professora: (cand[0].prof || '').trim() || null, debug: cand.map(c => c.raw).slice(0, 6) };
  }, HORA_ALVO, CHAVE);

  return res;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────
async function runCircuitoConvocacao({ dry = false } = {}) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   CIRCUITO — Convocatória (quarta)                ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  let professora = null;
  const scraper = new EvoScraper();
  try {
    await scraper.init();
    await scraper.login();
    const res = await buscarProfessora(scraper);
    professora = res && res.professora;
    console.log(`   Professora do Circuito (sábado ${HORA_ALVO}): ${professora || '(não encontrada)'}`);
    if (res && res.debug) console.log(`   🔎 cards vistos: ${res.debug.join('  //  ')}`);
  } catch (e) {
    console.log(`   ⚠️  Falha ao ler a grade: ${e.message}`);
  } finally {
    try { await scraper.close(); } catch (_) {}
  }

  if (!professora) {
    professora = process.env.CIRCUITO_PROFESSORA_PADRAO || '';
    if (!professora) {
      // Sem professora e sem fallback: não manda mensagem quebrada. Avisa no ntfy.
      notif.alertar('Circuito: professora não encontrada',
        'Não achei a professora do Circuito de sábado na Grade. A convocatória NÃO foi enviada. '
        + 'Confira a Grade > Horários ou defina CIRCUITO_PROFESSORA_PADRAO no .env.',
        { tags: 'warning' });
      console.log('   ❌ Sem professora e sem fallback — convocatória NÃO enviada.');
      return;
    }
    console.log(`   ↪️  Usando professora padrão do .env: ${professora}`);
  }

  const msg = msgConvocacao(professora);
  console.log('\n--- MENSAGEM ---\n' + msg + '\n----------------');
  if (dry) { console.log('🧪 DRY — nada enviado.'); return; }

  const wa = require('./wa-client');
  await wa.sendGrupo(GRUPO, msg);
  console.log(`✅ Convocatória enviada no grupo "${GRUPO}".`);
}

async function runCircuitoLembrete({ dry = false } = {}) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   CIRCUITO — Lembrete (sexta)                     ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('\n--- MENSAGEM ---\n' + MSG_LEMBRETE + '\n----------------');
  if (dry) { console.log('🧪 DRY — nada enviado.'); return; }

  const wa = require('./wa-client');
  await wa.sendGrupo(GRUPO, MSG_LEMBRETE);
  console.log(`✅ Lembrete enviado no grupo "${GRUPO}".`);
}

module.exports = { runCircuitoConvocacao, runCircuitoLembrete, buscarProfessora, msgConvocacao, MSG_LEMBRETE };

// ─── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = !args.includes('--enviar');
  const ehLembrete = args.includes('--lembrete');
  (async () => {
    try {
      if (!dry) await require('./wa-client').initWhatsApp();
      if (ehLembrete) await runCircuitoLembrete({ dry });
      else await runCircuitoConvocacao({ dry });
    } catch (e) {
      console.error('❌ erro:', e.message);
    } finally {
      if (!dry) { try { await require('./wa-client').destroy(); } catch (_) {} }
      process.exit(0);
    }
  })();
}
