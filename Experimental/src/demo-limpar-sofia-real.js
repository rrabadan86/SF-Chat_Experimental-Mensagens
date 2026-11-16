/**
 * demo-limpar-sofia-real.js — tira da pasta da SoFIA de uma UNIDADE REAL os dados
 * fictícios que o gerador da demonstração gravou lá por engano (quando o terminal
 * tinha SOFIA_DIR da unidade exportado e o demo-dados.js usou essa pasta).
 *
 * Só remove o que é da demonstração (telefones fictícios 55 62 90000-xxxx e as
 * campanhas "demo-…"). Antes de mexer, copia cada arquivo para
 * <pasta da SoFIA>/backup-antes-limpeza-<data>/.
 *
 * PARE a SoFIA antes (ela guarda as conversas na memória e regravaria o arquivo):
 *   pm2 stop sofia-listener
 *   cd /root/SF-Chat_Experimental-Mensagens/Experimental && node src/demo-limpar-sofia-real.js
 *   pm2 start sofia-listener
 *
 *   node src/demo-limpar-sofia-real.js --simular     # só mostra o que faria
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');

const SIMULAR = process.argv.includes('--simular');
const i = process.argv.indexOf('--pasta');
const SOFIA = path.resolve(i > 0 ? process.argv[i + 1] : (process.env.SOFIA_DIR || path.resolve(__dirname, '..', '..', 'ChatBot')));
if (/^(1|true|sim|yes)$/i.test(String(process.env.PAINEL_DEMO || ''))) {
  console.error('Rode na pasta da UNIDADE REAL (ex.: /root/SF-Chat_Experimental-Mensagens/Experimental), não na demonstração.');
  process.exit(1);
}
const FICT = /^556290000\d{4}$/;                       // telefones da demonstração
const FICT8 = /^000[0-2]\d{4}$/;                       // os mesmos, pelos 8 últimos dígitos
const ehFict = (t) => FICT.test(String(t || '').replace(/\D/g, '').replace(/@.*/, ''));
const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const BKP = path.join(SOFIA, 'backup-antes-limpeza-' + carimbo);

console.log(`Pasta da SoFIA: ${SOFIA}${SIMULAR ? '   (simulação — nada será gravado)' : ''}\n`);
let total = 0;
function tratar(arq, fn) {
  const p = path.join(SOFIA, arq);
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  const r = fn(txt);
  if (!r || !r.removidos) { console.log(`  ✔ ${arq}: nada da demonstração`); return; }
  total += r.removidos;
  console.log(`  ✂ ${arq}: ${r.removidos} item(ns) da demonstração removido(s) · ${r.ficam} ficam`);
  if (SIMULAR) return;
  fs.mkdirSync(BKP, { recursive: true });
  fs.copyFileSync(p, path.join(BKP, arq));
  const tmp = p + '.tmp'; fs.writeFileSync(tmp, r.txt); fs.renameSync(tmp, p);
}
const objeto = (testa) => (txt) => {
  let o; try { o = JSON.parse(txt); } catch (_) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const ks = Object.keys(o).filter(k => testa(k));
  for (const k of ks) delete o[k];
  return { removidos: ks.length, ficam: Object.keys(o).length, txt: JSON.stringify(o) };
};
const linhas = (campo) => (txt) => {
  const ls = txt.split('\n').filter(Boolean);
  const ficam = ls.filter(l => { try { return !ehFict(JSON.parse(l)[campo]); } catch (_) { return true; } });
  return { removidos: ls.length - ficam.length, ficam: ficam.length, txt: ficam.join('\n') + (ficam.length ? '\n' : '') };
};

tratar('sofia-conversas.json', objeto(ehFict));
tratar('sofia-encerradas.json', objeto(ehFict));
tratar('sofia-agendaram-canal.json', objeto(k => FICT8.test(k)));
tratar('sofia-tag-log.jsonl', linhas('chave'));
tratar('sofia-custo.jsonl', linhas('tel'));
tratar('campanhas.json', (txt) => {
  let a; try { a = JSON.parse(txt); } catch (_) { return null; }
  if (!Array.isArray(a)) return null;
  const ficam = a.filter(c => !(c && /^demo-/.test(String(c.id || ''))));
  return { removidos: a.length - ficam.length, ficam: ficam.length, txt: JSON.stringify(ficam) };
});
const foto = path.join(SOFIA, 'humano-fotos', 'grade-demo.png');
if (fs.existsSync(foto)) { console.log('  ✂ humano-fotos/grade-demo.png (imagem da demonstração)'); if (!SIMULAR) fs.unlinkSync(foto); }

console.log(`\n${total ? (SIMULAR ? `Simulação: ${total} item(ns) seriam removidos.` : `✅ ${total} item(ns) da demonstração removidos. Cópia do que havia antes: ${BKP}`) : '✅ Nenhum dado da demonstração nesta pasta.'}`);
if (!SIMULAR && total) console.log('Agora: pm2 start sofia-listener — e, no painel, SoFIA → Conversas → "Reimportar histórico" para trazer as conversas de volta do WhatsApp.');
