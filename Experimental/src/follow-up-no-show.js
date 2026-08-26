require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const EvoScraper = require('./evo-scraper');
const config = require('./config');
const { connectWhatsApp } = require('./aniversariantes-mes-grupo');
const { enviarUma } = require('./enviar_confirmacoes');

// ═══════════════════════════════════════════════════════════
//  Follow-up de NO-SHOW (faltou na aula experimental) → convida a remarcar.
//  Dois horários por dia:
//    11:30 → faltas nas aulas da MANHÃ (--periodo=manha)
//    19:30 → faltas nas aulas da TARDE/NOITE (--periodo=tarde)
//
//  Envia pelo MESMO perfil do WhatsApp do Studio (Edge, porta 9226).
//
//  Uso:
//    node src/followup-noshow.js --periodo=manha            → ENVIA
//    node src/followup-noshow.js --periodo=tarde --dry       → só lista (não envia)
//    node src/followup-noshow.js --periodo=manha --teste=62999999999
// ═══════════════════════════════════════════════════════════

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DRY = process.argv.includes('--dry');
const argPeriodo = (process.argv.find(a => a.startsWith('--periodo=')) || '').split('=')[1] || 'manha';
const argTeste = (process.argv.find(a => a.startsWith('--teste=')) || '').split('=')[1];
const periodo = argPeriodo === 'tarde' ? 'afternoon' : 'morning';
const label = periodo === 'afternoon' ? 'Tarde/Noite (após 11:30)' : 'Manhã (até 11:30)';

async function runNoShow(periodoFiltro) {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  🚫 Follow-up de FALTAS (no-show) — SlimFit         ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`   Período: ${label}\n`);

  // 1. Lê as faltas de hoje no EVO — com retry. O puppeteer às vezes solta um
  //    "detached Frame" (frame morto na navegação, comum com o EVO instável);
  //    antes isso matava o job. Agora tenta até 3x com um navegador novo.
  let alunos = [];
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const scraper = new EvoScraper();
    try {
      await scraper.init();
      await scraper.login();
      alunos = await scraper.getTodayNoShowClasses(periodoFiltro);
      ultimoErro = null;
      break;
    } catch (e) {
      ultimoErro = e;
      console.log(`   ⚠️  Tentativa ${tentativa}/3 falhou: ${e.message}`);
      if (tentativa < 3) { console.log('   ⏳ aguardando 20s antes de tentar de novo...'); await sleep(20000); }
    } finally {
      try { await scraper.close(); } catch (_) { /* ignore */ }
    }
  }
  if (ultimoErro) throw ultimoErro;

  if (alunos.length === 0) {
    console.log('\n┌─────────────────────────────────────────────────────┐');
    console.log(`│  📭 Sem faltas para o período (${label}).`.padEnd(55) + '│');
    console.log('└─────────────────────────────────────────────────────┘\n');
    return { enviadas: 0, alunos: [] };
  }

  console.log(`\n📋 ${alunos.length} falta(s) para remarcar:\n`);
  alunos.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} | ${a.time || '--:--'} | Tel: ${a.phone || 'sem telefone'}`));

  if (DRY) { console.log('\n🧪 Modo --dry: NADA foi enviado.'); return { enviadas: 0, alunos }; }

  // 2. Conecta WhatsApp (perfil do Studio) e envia
  const { browser, page } = await connectWhatsApp();
  let enviadas = 0, falhas = 0, puladas = 0;
  try {
    for (const aluno of alunos) {
      const destino = argTeste || aluno.phone;
      if (!destino || destino === 'N/A') { console.log(`⏭️  ${aluno.name}: sem telefone`); puladas++; continue; }

      const primeiroNome = (aluno.name || '').trim().split(/\s+/)[0] || 'tudo bem';
      const texto = config.messageNoShow(primeiroNome, aluno.time);

      console.log(`\n📨 Enviando para ${aluno.name} (${destino})${argTeste ? ' [TESTE]' : ''}...`);
      try {
        await enviarUma(page, destino, texto, 'no_show');
        enviadas++;
        console.log('   ✅ Enviada');
      } catch (err) {
        falhas++;
        console.log(`   ❌ Falha: ${err.message}`);
      }
      await sleep(10000 + Math.floor(Math.random() * 2000)); // 10-12s entre mensagens

      if (argTeste) break; // no modo teste manda só 1
    }
  } finally {
    browser.disconnect();
  }

  console.log(`\n📊 Resultado — ✅ ${enviadas}  ❌ ${falhas}  ⏭️ ${puladas}`);

  // Um único aviso no celular com o total (só quando houve falha).
  require('./notificar').alertarResumo(`Faltas ${label}`, { enviadas, falhas, puladas });

  return { enviadas, falhas, puladas, alunos };
}

async function runNoShowMorning() { return runNoShow('morning'); }
async function runNoShowAfternoon() { return runNoShow('afternoon'); }

module.exports = { runNoShowMorning, runNoShowAfternoon };

if (require.main === module) {
  runNoShow(periodo)
    .then(() => process.exit(0))
    .catch(err => { console.error('\n❌ Erro:', err.message); process.exit(1); });
}
