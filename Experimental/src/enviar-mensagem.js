// enviar-mensagem.js
// Envia um TEXTO (de um arquivo) para uma lista de números pelo WhatsApp do
// Studio. Serve para mensagens pontuais/personalizadas, sem depender do EVO.
//
// Uso (no VPS; PARE o scheduler antes, pois compartilham a sessão do WhatsApp):
//   pm2 stop slimfit-exp
//   node src/enviar-mensagem.js --arquivo=mensagem.txt --para=62996256138,62999123089 --dry
//   node src/enviar-mensagem.js --arquivo=mensagem.txt --para=62996256138,62999123089 --enviar
//   pm2 start slimfit-exp
//
// --dry     → só mostra para quem enviaria e a prévia do texto (não envia)
// --enviar  → envia de verdade
// O texto vem de ARQUIVO de propósito: preserva acentos, emojis e quebras de
// linha sem problema de aspas no terminal.

try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); }
catch (_) { /* segue sem dotenv */ }
const fs = require('fs');

const arg = (nome) => {
  const a = process.argv.find(x => x.startsWith(`--${nome}=`));
  return a ? a.split('=').slice(1).join('=') : null;
};
const DRY = process.argv.includes('--dry') || !process.argv.includes('--enviar');

const arquivo = arg('arquivo');
const paraRaw = arg('para') || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizar(t) {
  let n = String(t || '').replace(/\D/g, '');
  if (!n) return '';
  if (!n.startsWith('55')) n = '55' + n;
  return n;
}

async function main() {
  if (!arquivo) { console.error('❌ Falta --arquivo=caminho.txt (o texto a enviar).'); process.exit(1); }
  if (!fs.existsSync(arquivo)) { console.error(`❌ Arquivo não encontrado: ${arquivo}`); process.exit(1); }
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/\s+$/, '');
  if (!texto.trim()) { console.error('❌ O arquivo está vazio.'); process.exit(1); }

  const numeros = paraRaw.split(',').map(normalizar).filter(Boolean);
  const unicos = [...new Set(numeros)]; // remove repetidos
  if (unicos.length === 0) { console.error('❌ Falta --para=numero1,numero2'); process.exit(1); }

  console.log('\n╔════════════════════════════════════════════════╗');
  console.log(`║   ENVIO DE MENSAGEM  ${DRY ? '🧪 SIMULAÇÃO (não envia)' : '🚀 ENVIO REAL'}`.padEnd(49) + '║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`\n📱 Destinatários (${unicos.length}): ${unicos.join(', ')}`);
  console.log('\n─── Texto ───────────────────────────────────────');
  console.log(texto);
  console.log('─────────────────────────────────────────────────\n');

  if (DRY) {
    console.log('🧪 SIMULAÇÃO — nada foi enviado.');
    console.log('   Para enviar de verdade, troque --dry por --enviar (com o scheduler parado).');
    return;
  }

  const wa = require('./wa-client');
  await wa.initWhatsApp();

  let ok = 0, falhas = 0;
  for (const num of unicos) {
    console.log(`📨 Enviando para ${num}...`);
    try {
      await wa.sendTexto(num, texto);
      console.log('   ✅ Enviada!');
      ok++;
    } catch (e) {
      console.log(`   ❌ Falha: ${e.message}`);
      falhas++;
    }
    await sleep(10000 + Math.floor(Math.random() * 2000)); // 10-12s entre envios
  }

  console.log(`\n✅ Enviadas: ${ok} | ❌ Falhas: ${falhas}\n`);
  try { require('./notificar').alertarResumo('Envio de mensagem', { enviadas: ok, falhas, puladas: 0 }); } catch (_) {}
  await wa.destroy();
  process.exit(0);
}

main().catch(e => { console.error('❌ Erro:', e && e.message); process.exit(1); });
