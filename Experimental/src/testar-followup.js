// testar-followup.js
// SIMULAÇÃO do follow-up: lê as aulas experimentais com Presença (por padrão, de
// ONTEM — igual ao job real) e SÓ IMPRIME, para cada pessoa, se ela virou aluna
// (contrato preenchido) e QUAL mensagem sairia. NÃO abre o WhatsApp, NÃO envia nada.
//
// Uso:
//   node src/testar-followup.js                 -> aulas de ONTEM (o que o job de hoje processa)
//   node src/testar-followup.js --data=27/07/2026   -> força uma data (formato do filtro do EVO)
//   node src/testar-followup.js --periodo=morning   -> só manhã (ou afternoon | all; padrão all)

const config = require('./config');
const EvoScraper = require('./evo-scraper');

function arg(nome, padrao = null) {
  const a = process.argv.find(x => x.startsWith(`--${nome}=`));
  return a ? a.split('=')[1] : padrao;
}

(async () => {
  const periodo = arg('periodo', 'all');           // morning | afternoon | all
  const dataOverride = arg('data', null);           // ex.: 27/07/2026 (opcional)

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  🧪 SIMULAÇÃO do Follow-up (NÃO envia nada)         ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`   Período: ${periodo}${dataOverride ? `  |  Data forçada: ${dataOverride}` : '  |  Data: ontem'}\n`);

  const scraper = new EvoScraper();
  let alunos = [];
  try {
    await scraper.init();
    await scraper.login();
    alunos = await scraper.getYesterdayPresenceClasses(periodo, dataOverride);
  } finally {
    await scraper.close();
  }

  if (!alunos.length) {
    console.log('\n📭 Nenhuma experimental com Presença no período. Nada a simular.\n');
    return;
  }

  console.log(`\n📋 ${alunos.length} pessoa(s) que receberiam follow-up:\n`);

  for (const aluno of alunos) {
    const nomeProfessora = (aluno.professor || '').trim().split(/\s+/)[0] || 'a professora';
    const ehAluna = aluno.virouAluna;
    const texto = ehAluna
      ? config.messageFollowupAluna(nomeProfessora)
      : config.messageFollowup(nomeProfessora);

    console.log('─────────────────────────────────────────────────────');
    console.log(`👤 ${aluno.name}`);
    console.log(`   Horário: ${aluno.time || '-'} | Prof: ${aluno.professor || '-'} | Status: ${aluno.status || '-'}`);
    console.log(`   Contrato detectado: ${aluno.contrato ? `"${aluno.contrato}"` : '(vazio)'}`);
    console.log(`   → virouAluna = ${ehAluna}  ⇒  ${ehAluna ? 'MSG "JÁ É ALUNA (boas-vindas)"' : 'MSG "AINDA NÃO fechou (convite p/ matrícula)"'}`);
    console.log('   ┌── Texto que seria enviado ──────────────────────');
    texto.split('\n').forEach(l => console.log(`   │ ${l}`));
    console.log('   └─────────────────────────────────────────────────\n');
  }

  console.log('✅ Simulação concluída. (Nenhuma mensagem foi enviada.)\n');
})().catch(e => { console.error('\n❌ Erro:', e.message); process.exit(1); });
