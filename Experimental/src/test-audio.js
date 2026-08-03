/**
 * test-audio.js — Envio pontual de teste (texto + áudio como voz).
 *
 * ATENÇÃO: usa a MESMA sessão do cliente persistente (wwebjs_auth). Não rode
 * com o scheduler do PM2 no ar — pare antes (pm2 stop slimfit-exp) e religue
 * depois (pm2 start slimfit-exp), senão o Chromium trava o perfil.
 *
 * Uso:
 *   node src/test-audio.js <numero> [nomeProfessora]
 *
 * Exemplos:
 *   node src/test-audio.js 5562981718205            # usa Raíssa por padrão
 *   node src/test-audio.js 5562981718205 Taynara
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const wa = require('./wa-client');
const config = require('./config');

const numero = process.argv[2];
const professora = process.argv[3] || 'Raíssa';

if (!numero) {
  console.error('Uso: node src/test-audio.js <numero> [nomeProfessora]');
  process.exit(1);
}

function acharAudio(professorStr) {
  const firstName = professorStr.trim().split(/\s+/)[0]
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pref = config.audio.map[firstName];
  if (!pref) return null;
  const dir = config.audio.dir;
  const extensions = ['.ogg', '.opus', '.oga', '.m4a', '.aac', '.mp3', '.wav'];
  try {
    const files = fs.readdirSync(dir);
    for (const ext of extensions) {
      for (const f of files) {
        const lower = f.toLowerCase();
        if (lower.startsWith(pref.toLowerCase()) && lower.endsWith(ext)) return path.join(dir, f);
      }
    }
  } catch (_) { /* pasta inacessível */ }
  return null;
}

(async () => {
  console.log('🐧 Conectando ao WhatsApp (usa a sessão salva)...');
  await wa.initWhatsApp();

  const audioPath = acharAudio(professora);
  console.log('Pasta de áudio:', config.audio.dir);
  console.log('Áudio resolvido:', audioPath || '(nenhum)');

  try {
    await wa.sendTexto(numero, `Teste de follow-up ✅ — áudio da professora ${professora} logo abaixo:`);
    console.log('📨 Texto enviado.');

    if (audioPath) {
      await wa.sendMidia(numero, audioPath, { comoVoz: true });
      console.log('🎵 Áudio enviado como mensagem de voz.');
    } else {
      console.log('⚠️  Áudio não encontrado para', professora, '— só o texto foi enviado.');
    }

    // Espera a entrega real antes de encerrar (senão destroy corta o envio).
    await new Promise((r) => setTimeout(r, 10000));
    console.log('🎉 Teste concluído.');
  } catch (e) {
    console.error('❌ Falha no teste:', e.message);
  } finally {
    await wa.destroy();
    process.exit(0);
  }
})();
