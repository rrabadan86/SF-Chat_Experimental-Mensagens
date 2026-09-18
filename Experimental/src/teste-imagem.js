// teste-imagem.js — EXPERIMENTO: envia a IMAGEM (flyer) sozinha e DEPOIS o texto,
// como duas mensagens, para ver se a imagem chega desse jeito (contorno do bug de
// mídia do WhatsApp Web). Não faz parte do robô — é só um teste manual.
//
// IMPORTANTE: compartilha a conexão com o robô. Pare antes:
//   pm2 stop slimfit-exp  →  (rode)  →  pm2 start slimfit-exp
//
// Uso:
//   xvfb-run -a node src/teste-imagem.js --para=5562999999999
//   xvfb-run -a node src/teste-imagem.js --para=5562999999999 --foto=aniversario
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); } catch (_) {}

function arg(nome) {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=').slice(1).join('=') : '';
}

if (require.main === module) (async () => {
  const para = arg('para');
  if (!para) { console.error('uso: node src/teste-imagem.js --para=5562...'); process.exit(1); }
  const chaveFoto = arg('foto') || 'aniversario';

  let foto = '';
  try { foto = require('./mensagens').fotoPath(chaveFoto) || ''; } catch (_) {}
  if (!foto) { console.error(`❌ Sem imagem salva na chave "${chaveFoto}" — nada pra testar.`); process.exit(1); }

  const wa = require('./wa-client');
  console.log('🐧 Conectando ao WhatsApp (sessão salva)…');
  await wa.initWhatsApp();
  try {
    const texto = '🧪 *Teste SlimFit* — a mensagem ACIMA deste texto deveria ser a *imagem (flyer)*.\n\n'
      + 'Chegou a imagem *antes* deste texto? 💛';
    const r = await wa.enviarFotoDepoisTexto(para, foto, texto, 'teste-imagem');
    console.log(`✅ Sequência enviada (imagem via: ${r && r.imagemVia}). Confira no WhatsApp se a IMAGEM chegou antes do texto.`);
  } catch (e) {
    console.error('❌ Falhou:', (e && e.message) || e);
  } finally {
    await wa.destroy();
  }
  process.exit(0);
})().catch((e) => { console.error('❌', (e && e.message) || e); process.exit(1); });
