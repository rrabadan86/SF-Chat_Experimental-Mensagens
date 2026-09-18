// teste-envio.js — Envia um TEXTO + IMAGEM (flyer) para um número, para validar
// o contorno de envio de mídia (WWebJS) sem incomodar grupos/alunas reais.
//
// IMPORTANTE: compartilha a conexão com o robô. Pare antes:
//   pm2 stop slimfit-exp  →  (rode este script)  →  pm2 start slimfit-exp
//
// Uso:
//   xvfb-run -a node src/teste-envio.js --para=5562999999999
//   xvfb-run -a node src/teste-envio.js --para=5562999999999 --foto=aniversario
//   xvfb-run -a node src/teste-envio.js --para=5562999999999 --sem-foto   (só texto)
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); } catch (_) {}

function arg(nome) {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=').slice(1).join('=') : '';
}

(async () => {
  const para = arg('para');
  if (!para) { console.error('uso: node src/teste-envio.js --para=5562...'); process.exit(1); }
  const semFoto = process.argv.includes('--sem-foto');
  const chaveFoto = semFoto ? '' : (arg('foto') || 'aniversario'); // usa o flyer de aniversário por padrão

  // Confere se a imagem existe (só avisa; segue como texto se não houver).
  let temFoto = false;
  if (chaveFoto) {
    try { const p = require('./mensagens').fotoPath(chaveFoto); temFoto = !!p; if (!p) console.log(`⚠️  Sem imagem salva na chave "${chaveFoto}" — vai só o texto.`); }
    catch (_) {}
  }

  const wa = require('./wa-client');
  console.log('🐧 Conectando ao WhatsApp (sessão salva)…');
  await wa.initWhatsApp();
  try {
    const texto = '🧪 *Teste SlimFit* — validando o envio de *texto + imagem* pelo robô.\n\n'
      + 'Se você recebeu este texto *com a imagem (flyer) junto*, o contorno de mídia está funcionando. '
      + 'Se veio *só o texto*, a imagem ainda depende do patch. 💛';
    await wa.sendTexto(para, texto, 'teste', chaveFoto || undefined);
    console.log(`✅ Enviado para ${para} — confira no WhatsApp se veio ${temFoto ? 'COM a imagem' : '(só texto)'}.`);
  } catch (e) {
    console.error('❌ Falhou:', (e && e.message) || e);
  } finally {
    await wa.destroy();
  }
  process.exit(0);
})().catch((e) => { console.error('❌', (e && e.message) || e); process.exit(1); });
