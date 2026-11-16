/**
 * recuperar-campanha.js — remonta uma campanha da SoFIA que sumiu de campanhas.json,
 * a partir do que ficou registrado em outros lugares:
 *   - auditoria do painel (data/auditoria.jsonl): nome, tag e quando foi criada;
 *   - log da SoFIA (~/.pm2/logs/sofia-listener-out*.log): cada envio (telefone e
 *     hora), as falhas e o último ritmo (teto/dia, intervalo, janela);
 *   - conversas da SoFIA (sofia-conversas.json, após "Reimportar histórico"): o
 *     texto que foi enviado → variações da mensagem;
 *   - foto da campanha (<pasta da SoFIA>/campanha-fotos/<id>.*).
 * A fila (pendentes) = contatos com a tag hoje − quem já recebeu − quem falhou.
 * A campanha volta como PAUSADA: confira no painel e clique em Iniciar.
 *
 * Uso (na pasta Experimental da unidade):
 *   node src/recuperar-campanha.js                          # lista o que encontrou
 *   node src/recuperar-campanha.js --nome "Black Friday" --simular
 *   pm2 stop sofia-listener
 *   node src/recuperar-campanha.js --nome "Black Friday"
 *   pm2 start sofia-listener
 * Opções: --tag <tag> (se a auditoria não tiver), --pasta <pasta da SoFIA>, --log <arquivo>.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const os = require('os');
const contatos = require('./contatos');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SIMULAR = process.argv.includes('--simular');
const NOME = arg('--nome', '');
const SOFIA = path.resolve(arg('--pasta', process.env.SOFIA_DIR || path.resolve(__dirname, '..', '..', 'ChatBot')));
const DATA = path.resolve(__dirname, '..', 'data');
const u8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const lerJson = (a, d) => { try { return JSON.parse(fs.readFileSync(a, 'utf8')); } catch (_) { return d; } };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ── 1. log da SoFIA ──────────────────────────────────────────────────────────
const logs = [];
const pastaLogs = path.join(os.homedir(), '.pm2', 'logs');
if (arg('--log')) logs.push(arg('--log'));
else { try { for (const f of fs.readdirSync(pastaLogs)) if (/sofia.*out.*\.log$/i.test(f)) logs.push(path.join(pastaLogs, f)); } catch (_) {} }
// "[sofia] 16/11/2026, 14:03:22 campanha ..." (hora de São Paulo)
const quando = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4}),? (\d{2}):(\d{2}):(\d{2})/.exec(s); return m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`) : 0; };
const camps = new Map(); // nome → dados do log
const de = (n) => { if (!camps.has(n)) camps.set(n, { nome: n, enviados: new Map(), falhas: new Map(), total: 0, ultimo: 0, ritmo: null, removidos: new Set(), vars: 0, criadaEm: 0, dest: 0 }); return camps.get(n); };
for (const arq of logs) {
  let txt = ''; try { txt = fs.readFileSync(arq, 'utf8'); } catch (_) { continue; }
  for (const l of txt.split('\n')) {
    if (l.indexOf('campanha "') < 0) continue;
    let m;
    if ((m = /campanha "(.+?)": enviada (\d+)\/(\d+) \((\d+)\)/.exec(l))) { const c = de(m[1]), t = quando(l); c.enviados.set(u8(m[4]), { tel: m[4], em: t }); c.total = +m[3]; c.ultimo = Math.max(c.ultimo, t); }
    else if ((m = /campanha "(.+?)": FALHA em (\d+) \((.*)\)\. Seguidas/.exec(l))) { const c = de(m[1]); c.falhas.set(u8(m[2]), { tel: m[2], erro: m[3].slice(0, 120), em: quando(l) }); }
    else if ((m = /campanha "(.+?)": ritmo atualizado — (\d+)-(\d+)s, teto (\d+)\/dia, janela (\d{2}:\d{2})-(\d{2}:\d{2})/.exec(l))) { de(m[1]).ritmo = { delayMinSeg: +m[2], delayMaxSeg: +m[3], limiteDia: +m[4], janelaIni: m[5], janelaFim: m[6] }; }
    else if ((m = /campanha "(.+?)": (\d+) removido da fila/.exec(l))) { de(m[1]).removidos.add(u8(m[2])); }
    else if ((m = /campanha "(.+?)" criada \((\d+) destinat/.exec(l))) { const c = de(m[1]); c.dest = +m[2]; c.criadaEm = quando(l); }
    else if ((m = /campanha "(.+?)" criada com (\d+) varia/.exec(l))) { const c = de(m[1]); c.vars = +m[2]; c.criadaEm = c.criadaEm || quando(l); }
  }
}
// ── 2. auditoria do painel (tag e criação) ───────────────────────────────────
const aud = [];
try { for (const l of fs.readFileSync(path.join(DATA, 'auditoria.jsonl'), 'utf8').split('\n')) { try { const r = JSON.parse(l); if (r && r.acao === 'campanha.criar') aud.push(r); } catch (_) {} } } catch (_) {}
for (const r of aud) { const c = de(r.alvo); const m = /tag: (.+?) · (\d+) contato/.exec(r.detalhe || ''); if (m) { c.tag = m[1]; c.dest = c.dest || +m[2]; } c.criadaEm = c.criadaEm || r.em; c.por = r.usuario; }

if (!NOME) {
  console.log(`Logs lidos: ${logs.length ? logs.join(', ') : 'nenhum (passe --log <arquivo>)'}\n`);
  if (!camps.size) { console.log('Nenhuma campanha encontrada no log nem na auditoria.'); process.exit(0); }
  console.log('Campanhas encontradas:');
  for (const c of [...camps.values()].sort((a, b) => (b.ultimo || b.criadaEm) - (a.ultimo || a.criadaEm))) {
    const ult = c.ultimo ? new Date(c.ultimo).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
    console.log(`  • "${c.nome}"  tag: ${c.tag || '?'} · enviadas ${c.enviados.size}${c.total ? '/' + c.total : ''} · falhas ${c.falhas.size} · último envio ${ult}`);
  }
  console.log('\nPara remontar uma: node src/recuperar-campanha.js --nome "<nome>" --simular');
  process.exit(0);
}

const C = camps.get(NOME) || [...camps.values()].find(c => norm(c.nome) === norm(NOME));
if (!C) { console.error(`Não achei a campanha "${NOME}". Rode sem --nome para ver a lista.`); process.exit(1); }
const TAG = arg('--tag', C.tag || '');
if (!TAG) { console.error('Não sei a tag desta campanha — passe --tag "<tag>".'); process.exit(1); }

// ── 3. fila: contatos com a tag − já receberam − falharam − removidos ─────────
const alvo = (contatos.listar({ tag: TAG, pagina: 0, porPagina: 100000 }).itens || []).filter(x => x.tel);
const conversas = lerJson(path.join(SOFIA, 'sofia-conversas.json'), {});
const conv8 = new Map(); for (const [k, v] of Object.entries(conversas)) conv8.set(u8(k), v);
const ja = (t) => C.enviados.has(u8(t)) || C.falhas.has(u8(t)) || C.removidos.has(u8(t));
const pendentes = alvo.filter(x => !ja(x.tel))
  .sort((a, b) => ((conv8.get(u8(b.tel)) || {}).ultimaEm || 0) - ((conv8.get(u8(a.tel)) || {}).ultimaEm || 0) || (Number(b.criadoEm) || 0) - (Number(a.criadoEm) || 0))
  .map(x => ({ tel: x.tel, nome: x.nome || '' }));

// ── 4. variações: o texto que a SoFIA mandou a quem recebeu ───────────────────
const nomeDe = (t) => { const r = contatos.acharPorTel(t); return r && r.contato ? String(r.contato.nome || '').trim().split(/\s+/)[0] : ''; };
const vars = new Map();
let comFoto = false;
for (const [k8, e] of C.enviados) {
  const cv = conv8.get(k8); if (!cv) continue;
  const cand = (cv.msgs || []).filter(m => m.autor !== 'aluna' && m.texto && (!e.em || Math.abs(m.em - e.em) < 10 * 60e3));
  if (!cand.length) continue;
  let t = cand.sort((a, b) => Math.abs(a.em - e.em) - Math.abs(b.em - e.em))[0].texto;
  if (/^📷/.test(t)) comFoto = true;
  t = t.replace(/^📷\s*(Imagem\s*(—\s*)?)?/u, '').replace(/([?&])c=[A-Z0-9]{6}\b&?/g, (m, s) => (s === '?' ? '?' : '')).replace(/\?$/, '').trim();
  const nm = nomeDe(e.tel);
  if (nm && nm.length >= 2) t = t.replace(new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), '{nome}');
  if (t) vars.set(t, (vars.get(t) || 0) + 1);
}
let variacoes = [...vars.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 20);
if (!variacoes.length) {
  const r = lerJson(path.join(SOFIA, 'campanha-rascunhos.json'), {});
  const ult = Object.values(r).sort((a, b) => (b.em || 0) - (a.em || 0))[0];
  if (ult && Array.isArray(ult.variacoes)) variacoes = ult.variacoes.slice(0, 20);
}
// ── 5. foto e id ─────────────────────────────────────────────────────────────
const snap = lerJson(path.join(DATA, 'campanhas-snapshot.json'), {});
const id = Object.keys(snap).sort((a, b) => Math.abs((snap[a].em || 0) - C.criadaEm) - Math.abs((snap[b].em || 0) - C.criadaEm))[0] || ('c' + (C.criadaEm || Date.now()));
let fotoArquivo = '';
try { const f = fs.readdirSync(path.join(SOFIA, 'campanha-fotos')).find(x => x.startsWith(id + '.')); if (f) fotoArquivo = path.join(SOFIA, 'campanha-fotos', f); } catch (_) {}

const R = C.ritmo || { delayMinSeg: 120, delayMaxSeg: 180, limiteDia: 40, janelaIni: '09:00', janelaFim: '20:00' };
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const camp = {
  id, nome: C.nome, tag: TAG, textoBase: variacoes[0] || '', variacoes,
  limiteDia: R.limiteDia, delayMinSeg: R.delayMinSeg, delayMaxSeg: R.delayMaxSeg, janelaIni: R.janelaIni, janelaFim: R.janelaFim,
  dataInicio: hoje, dataFim: '', dias: [], fotoArquivo, status: 'pausada',
  pendentes, enviados: [...C.enviados.values()].map(e => ({ tel: e.tel, nome: nomeDe(e.tel), em: e.em || Date.now() })).sort((a, b) => a.em - b.em),
  falhas: [...C.falhas.values()], enviadosHoje: [...C.enviados.values()].filter(e => e.em && new Date(e.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === hoje).length, // o teto do dia conta o que já saiu hoje diaRef: hoje, proxEnvioEm: 0, criadoEm: C.criadaEm || Date.now(), atualizadoEm: Date.now(), recuperada: true,
};

console.log(`Campanha "${camp.nome}" · tag "${TAG}"${C.por ? ' · criada por ' + C.por : ''}`);
console.log(`  já receberam: ${camp.enviados.length} · falharam: ${camp.falhas.length} · removidos à mão: ${C.removidos.size}`);
console.log(`  fila que falta: ${pendentes.length}  (contatos com a tag hoje: ${alvo.length}${C.total ? ` · o log dizia ${C.total} no total` : ''})`);
console.log(`  ritmo: ${R.delayMinSeg}-${R.delayMaxSeg}s · ${R.limiteDia}/dia · janela ${R.janelaIni}-${R.janelaFim}${C.ritmo ? '' : ' (padrão — ajuste no painel se era outro)'}`);
console.log(`  foto: ${fotoArquivo || (comFoto ? '⚠️ a campanha tinha foto, mas não achei o arquivo' : 'sem foto')}`);
console.log(`  variações recuperadas: ${variacoes.length}`);
variacoes.slice(0, 3).forEach((v, i) => console.log(`    ${i + 1}) ${v.replace(/\n/g, ' ⏎ ').slice(0, 160)}`));
if (!variacoes.length) { console.error('\n⚠️  Não achei o texto da campanha. Faça "Reimportar histórico" no painel e rode de novo.'); process.exit(1); }

if (SIMULAR) { console.log('\n(simulação — nada foi gravado)'); process.exit(0); }
try {
  const st = JSON.parse(require('child_process').execSync('pm2 jlist', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const on = st.find(p => /sofia/i.test(p.name) && p.pm2_env && p.pm2_env.status === 'online' && String(p.pm2_env.pm_cwd || '').startsWith(path.resolve(__dirname, '..', '..')));
  if (on) { console.error(`\n⚠️  A SoFIA (${on.name}) está ligada — ela regravaria o arquivo. Rode: pm2 stop ${on.name}  e depois este comando de novo.`); process.exit(1); }
} catch (_) {}
const ARQ = path.join(SOFIA, 'campanhas.json');
const lista = lerJson(ARQ, []);
if (fs.existsSync(ARQ)) fs.copyFileSync(ARQ, ARQ + '.antes-recuperar-' + Date.now());
const sem = (Array.isArray(lista) ? lista : []).filter(c => c && c.id !== camp.id);
sem.unshift(camp);
fs.writeFileSync(ARQ + '.tmp', JSON.stringify(sem)); fs.renameSync(ARQ + '.tmp', ARQ);
console.log(`\n✅ Campanha recuperada como PAUSADA em ${ARQ}.\nAgora: pm2 start sofia-listener → painel SoFIA → Campanhas → confira a fila e as variações → Iniciar.`);
