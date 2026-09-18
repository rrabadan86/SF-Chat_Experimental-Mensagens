// patch-wwebjs.js — aplica, no BOOT, a correção do bug de envio de MÍDIA da
// whatsapp-web.js no WhatsApp Web de 2026:
//   "Data passed to getter must include an id property (it's how we memoize) but got undefined"
//
// Causa: ao enviar mídia, o MediaData tem um campo privado __x_id que colide com
// o __x_id do Msg quando as props são espalhadas → o WhatsApp Web estoura o erro
// e a imagem/vídeo não sai. O fix é uma linha no Utils.js (código injetado):
//   delete message.__x_id;   (antes do bloco canonicalUrl, dentro do LoadUtils)
// Fontes: wwebjs/whatsapp-web.js#201921/#201922 e whatsapp-connect@69d9731.
//
// Idempotente e best-effort: roda a cada start, sobrevive a `npm install`, nunca
// derruba o processo.
const fs = require('fs');
const path = require('path');

function aplicar() {
  try {
    let base;
    try { base = path.dirname(require.resolve('whatsapp-web.js/package.json')); }
    catch (_) { return { ok: false, motivo: 'whatsapp-web.js não encontrado' }; }
    const f = path.join(base, 'src', 'util', 'Injected', 'Utils.js');
    if (!fs.existsSync(f)) return { ok: false, motivo: 'Utils.js não encontrado' };
    let s = fs.readFileSync(f, 'utf8');
    if (s.includes('__x_id')) return { ok: true, motivo: 'já aplicado' };
    const i = s.indexOf('canonicalUrl is set');
    if (i < 0) return { ok: false, motivo: 'âncora canonicalUrl não encontrada (versão nova da lib?)' };
    const ls = s.lastIndexOf('\n', i) + 1;
    const indent = (s.slice(ls).match(/^[ \t]*/) || [''])[0];
    s = s.slice(0, ls) + indent + 'delete message.__x_id; // fix midia (memoize) — patch-wwebjs\n' + s.slice(ls);
    fs.writeFileSync(f, s);
    return { ok: true, motivo: 'aplicado' };
  } catch (e) { return { ok: false, motivo: (e && e.message) || String(e) }; }
}

const r = aplicar();
try { console.log(`[patch-wwebjs] fix de midia (__x_id): ${r.ok ? '✅ ' + r.motivo : '⚠️ ' + r.motivo}`); } catch (_) {}

module.exports = { aplicar };
