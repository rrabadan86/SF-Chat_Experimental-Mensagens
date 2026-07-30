/**
 * Testa o conector de WhatsApp COMPARTILHADO (connectWhatsApp), que é usado
 * pelos jobs de no-show, follow-up e aniversariantes no Studio.
 *
 * Uso:  xvfb-run -a node src/testar-wa-connect.js 5562981718205
 */
const { connectWhatsApp } = require('./aniversariantes-mes-grupo');
const { enviarUma } = require('./enviar_confirmacoes');

(async () => {
  const numero = process.argv[2] || '5562981718205';
  console.log(`\n🔌 Testando connectWhatsApp() e envio para ${numero}...\n`);
  const { browser, page } = await connectWhatsApp();
  try {
    await enviarUma(page, numero, 'Teste do conector compartilhado do SlimFit (no-show / follow-up / aniversariantes) ✅');
    console.log('\n🎉 Mensagem enviada pelo conector compartilhado!');
  } finally {
    browser.disconnect();
  }
})().catch((e) => {
  console.error('\n❌ Erro:', e.message);
  process.exit(1);
});
