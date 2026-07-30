require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const EvoScraper = require('./evo-scraper');
const { connectWhatsApp, enviarTextoNoGrupo, GRUPO } = require('./aniversariantes-mes-grupo');

// ═══════════════════════════════════════════════════════════
//  Resumo da SEMANA das aulas experimentais → grupo da equipe.
//  Toda sexta 16:30. Lê os cartões do EVO (Aulas agendadas, Presenças,
//  Vendas de novos contratos) com o filtro "Esta semana" e monta a mensagem.
//
//  Uso:
//    node src/resumo-semana.js          → monta e ENVIA no grupo
//    node src/resumo-semana.js --dry     → só monta e imprime (não envia)
// ═══════════════════════════════════════════════════════════

const DRY = process.argv.includes('--dry');

function pct(a, b) { return (b && b > 0) ? Math.round((a / b) * 100) + '%' : '—'; }

function montarMensagem(r) {
  const ag = r.agendadas ?? 0;
  const pr = r.presencas ?? 0;
  const ve = r.vendas ?? 0;
  const faltas = Math.max(ag - pr, 0);
  return '📊 *Resumo da semana — Aulas experimentais*\n\n' +
    `• Agendadas/Remarcadas: *${ag}*\n` +
    `• Presenças: *${pr}* (${pct(pr, ag)})\n` +
    `• Faltas: *${faltas}*\n` +
    `• Matrículas: *${ve}* (${pct(ve, pr)} das presenças)`;
}

async function runResumoSemana() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   RESUMO DA SEMANA → Grupo da Equipe              ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`   Grupo: ${GRUPO}\n`);

  // 1. Lê o resumo no EVO
  const scraper = new EvoScraper();
  let resumo = {};
  try {
    await scraper.init();
    await scraper.login();
    resumo = await scraper.getWeekSummary();
  } finally {
    await scraper.close();
  }

  if (resumo && resumo._diagCards) console.log('   🔎 Cartões (diag):', JSON.stringify(resumo._diagCards));

  const msg = montarMensagem(resumo || {});
  console.log('\n─── Mensagem ───────────────────────────────────────');
  console.log(msg);
  console.log('────────────────────────────────────────────────────');

  // Se não achou nenhuma linha (agendadas 0), não envia (evita resumo vazio).
  if ((resumo.agendadas ?? 0) === 0) {
    console.log('\n⚠️  Nenhuma experimental lida na semana — NÃO enviei.');
    return { enviado: false };
  }

  if (DRY) { console.log('\n🧪 Modo --dry: NADA foi enviado.'); return { enviado: false }; }

  // 2. Envia no grupo
  const { browser, page } = await connectWhatsApp();
  let ok = false;
  try {
    ok = await enviarTextoNoGrupo(page, GRUPO, msg);
  } finally {
    browser.disconnect();
  }
  console.log(ok ? '\n✅ Concluído.' : '\n⚠️  Não foi possível enviar.');
  return { enviado: ok };
}

module.exports = { runResumoSemana };

if (require.main === module) {
  runResumoSemana()
    .then(() => process.exit(0))
    .catch(err => { console.error('\n❌ Erro:', err.message); process.exit(1); });
}
