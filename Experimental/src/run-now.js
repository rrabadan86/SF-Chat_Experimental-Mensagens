/**
 * Script para teste manual.
 *
 * Uso:
 *   node src/run-now.js scrape      → Testa apenas o scraping do EVO (sem enviar mensagem)
 *   node src/run-now.js morning     → Roda o job da manhã agora (scrape + WhatsApp)
 *   node src/run-now.js afternoon   → Roda o job da tarde agora (scrape + WhatsApp)
 *   node src/run-now.js whatsapp    → Testa apenas a conexão do WhatsApp
 */

const config = require('./config');
const EvoScraper = require('./evo-scraper');
const WhatsAppSender = require('./whatsapp-sender');

// ─── Helpers ───────────────────────────────────────────────
function printStudents(students) {
  if (students.length === 0) {
    console.log('   Nenhum aluno encontrado.');
    return;
  }

  console.log('\n┌─────────────────────────────────────────────────────────────────────────┐');
  console.log('│  #  │ Nome                   │ Atividade  │ Horário │ Telefone         │');
  console.log('├─────────────────────────────────────────────────────────────────────────┤');
  students.forEach((s, i) => {
    const num = String(i + 1).padStart(2);
    const name = s.name.substring(0, 22).padEnd(22);
    const act = (s.activity || '-').substring(0, 10).padEnd(10);
    const time = (s.time || '-').padEnd(7);
    const phone = (s.phone || 'N/A').padEnd(16);
    console.log(`│  ${num} │ ${name} │ ${act} │ ${time} │ ${phone} │`);
  });
  console.log('└─────────────────────────────────────────────────────────────────────────┘');
}

// ─── Test: Scrape Only ─────────────────────────────────────
async function testScrape() {
  console.log('\n🔍 Teste: Scraping do EVO (sem enviar mensagens)\n');

  const scraper = new EvoScraper();

  try {
    await scraper.init();
    await scraper.login();

    console.log('\n── Aulas de HOJE (após 12h) ──');
    const todayClasses = await scraper.getTodayAfternoonClasses();
    printStudents(todayClasses);

    console.log('\n── Aulas de AMANHÃ (até 11:30) ──');
    const tomorrowClasses = await scraper.getTomorrowMorningClasses();
    printStudents(tomorrowClasses);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error.stack);
  } finally {
    await scraper.close();
  }
}

// ─── Test: Morning Job ─────────────────────────────────────
async function testMorning() {
  console.log('\n🌅 Teste: Job da Manhã (hoje, aulas após 12h)\n');

  const scraper = new EvoScraper();
  const whatsapp = new WhatsAppSender();

  try {
    // Primeiro conecta o WhatsApp
    await whatsapp.init();

    // Scrape
    await scraper.init();
    await scraper.login();
    const classes = await scraper.getTodayAfternoonClasses();
    await scraper.close();

    printStudents(classes);

    if (classes.length === 0) {
      console.log('\n✨ Nenhuma aula para enviar mensagem.');
      return;
    }

    // Envia
    const results = await whatsapp.sendBulkMessages(classes, config.messagesToday);
    console.log('\n📊 Resultado:', results);
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await scraper.close();
    await whatsapp.close();
  }
}

// ─── Test: Afternoon Job ───────────────────────────────────
async function testAfternoon() {
  console.log('\n🌙 Teste: Job da Tarde (amanhã, aulas até 11:30)\n');

  const scraper = new EvoScraper();
  const whatsapp = new WhatsAppSender();

  try {
    // Primeiro conecta o WhatsApp
    await whatsapp.init();

    // Scrape
    await scraper.init();
    await scraper.login();
    const classes = await scraper.getTomorrowMorningClasses();
    await scraper.close();

    printStudents(classes);

    if (classes.length === 0) {
      console.log('\n✨ Nenhuma aula para enviar mensagem.');
      return;
    }

    // Envia
    const results = await whatsapp.sendBulkMessages(classes, config.messagesTomorrow);
    console.log('\n📊 Resultado:', results);
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await scraper.close();
    await whatsapp.close();
  }
}

// ─── Test: WhatsApp Only ───────────────────────────────────
async function testWhatsApp() {
  console.log('\n📱 Teste: WhatsApp Web via Chrome\n');
  console.log('O Chrome vai abrir com WhatsApp Web.');
  console.log('Se for a primeira vez, escaneie o QR code na tela.\n');

  const whatsapp = new WhatsAppSender();

  try {
    await whatsapp.init();

    // Se um número de teste foi passado como argumento
    const testNumber = process.argv[3];
    if (testNumber) {
      const testTime = process.argv[4] || '07:00';
      const testName = process.argv[5] || 'Teste';
      const msg = config.messagesTomorrow(testName, testTime);
      console.log(`\n📨 Enviando mensagem teste para ${testNumber}...`);
      console.log(`   Mensagem: ${msg.substring(0, 80)}...\n`);
      const ok = await whatsapp.sendMessage(testNumber, msg);
      console.log(ok ? '\n🎉 Teste bem-sucedido!' : '\n❌ Teste falhou');
    } else {
      console.log('\n✅ WhatsApp Web conectado!');
      console.log('   Para testar envio: node src/run-now.js whatsapp 5562981718205');
      console.log('   Pressione Ctrl+C para sair.\n');
      await new Promise((resolve) => { process.on('SIGINT', resolve); });
    }
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await whatsapp.close();
  }
}

// ─── Main ──────────────────────────────────────────────────
const mode = process.argv[2] || 'scrape';

console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║  🏋️  Slimfit - Teste Manual                          ║');
console.log(`║  Modo: ${mode.padEnd(46)}║`);
console.log('╚═══════════════════════════════════════════════════════╝');

switch (mode) {
  case 'scrape':
    testScrape().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'morning':
    testMorning().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'afternoon':
    testAfternoon().then(() => process.exit(0)).catch(() => process.exit(1));
    break;
  case 'whatsapp':
    testWhatsApp();
    break;
  default:
    console.log(`\n❌ Modo desconhecido: "${mode}"`);
    console.log('   Modos disponíveis: scrape, morning, afternoon, whatsapp');
    process.exit(1);
}
