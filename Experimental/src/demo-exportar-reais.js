/**
 * demo-exportar-reais.js — leva CONVERSAS REAIS da SoFIA para o painel de demonstração,
 * trocando nome, telefone e outros dados pessoais por dados fictícios.
 *
 * Rode NA UNIDADE REAL (ex.: Bueno), na pasta Experimental da unidade:
 *
 *   cd /root/SF-Chat_Experimental-Mensagens/Experimental
 *   node src/demo-exportar-reais.js                     # 4 conversas por tag
 *   node src/demo-exportar-reais.js --por-tag 6
 *   node src/demo-exportar-reais.js --excluir 3,7       # tira as conversas 3 e 7 da lista
 *
 * Grava /root/slimfit-exemplo/sofia-demo/demo-conversas-reais.json (ou o caminho em
 * --saida). Esse arquivo fica SÓ no servidor (não vai para o GitHub). O gerador da
 * demonstração (demo-dados.js) passa a usar estas conversas no lugar das de exemplo.
 *
 * O que é trocado: nome e sobrenomes da pessoa (em qualquer lugar do texto), outros
 * nomes próprios conhecidos (contatos, alunas, professoras, equipe), telefones,
 * e-mails, CPF, CEP, datas de nascimento, @ do Instagram, links e números longos.
 * O texto da SoFIA e da aluna fica igual ao real. Revise na demonstração antes de
 * divulgar e use --excluir para tirar alguma conversa.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const contatos = require('./contatos');

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const POR_TAG = Math.max(1, parseInt(arg('--por-tag', '4'), 10) || 4);
const EXCLUIR = new Set(String(arg('--excluir', '')).split(',').map(s => parseInt(s, 10)).filter(n => n > 0));
const SOFIA = path.resolve(process.env.SOFIA_DIR || path.resolve(__dirname, '..', '..', 'ChatBot'));
const DATA = path.resolve(__dirname, '..', 'data');
const SAIDA = path.resolve(arg('--saida', '/root/slimfit-exemplo/sofia-demo/demo-conversas-reais.json'));

const TAGS = ['FX - 5. Fez Aula Experimental', 'FX - 3. Agendou Aula Exp', 'FX - 2. Encerrado com Agendamento sem Presença', 'FX - 0. Sem interesse', '0. Aluna', '0. Patrocinado'];

const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (_) { return padrao; } };
const lerJsonl = (arq) => { try { return fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; } };
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => semAcento(s).toLowerCase().trim();
const chaveTag = (t) => norm(t).replace(/\s+/g, ' ');

// ── nomes fictícios ──────────────────────────────────────────────────────────
const FICT_NOMES = ['Ana Beatriz', 'Bruna', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Karina', 'Larissa', 'Mariana', 'Natália', 'Olívia', 'Patrícia', 'Rafaela', 'Sabrina', 'Tatiana', 'Vanessa', 'Aline', 'Bianca', 'Carolina', 'Débora', 'Elisa', 'Flávia', 'Giovana', 'Jéssica', 'Letícia', 'Michele', 'Nicole', 'Paula', 'Renata', 'Simone', 'Thaís', 'Vitória', 'Amanda', 'Beatriz', 'Cristina', 'Denise', 'Érica', 'Fabiana', 'Gisele', 'Lorena', 'Marcela', 'Priscila', 'Raquel', 'Sílvia', 'Talita', 'Yasmin', 'Adriana', 'Luana', 'Mirela', 'Roberta', 'Valéria', 'Lívia', 'Manuela', 'Cecília'].map(n => n.split(' ')[0]);
const FICT_SOBRENOMES = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gouveia', 'Holanda', 'Lacerda', 'Machado', 'Nogueira', 'Pacheco', 'Queiroz', 'Rezende', 'Sampaio', 'Teixeira', 'Vasconcelos', 'Xavier', 'Zanetti', 'Moreira', 'Campos', 'Rocha', 'Prado'];
const FICT_EQUIPE = ['Ana', 'Bia', 'Carol', 'Duda', 'Júlia'];
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };

// Nomes comuns (para pegar quem é citado na conversa: "minha amiga Renata").
const COMUNS = ('ana maria julia juliana mariana fernanda patricia aline amanda bruna camila carla carolina cristina daniela debora eduarda elaine eliane fabiana flavia gabriela giovana helena isabela jessica joana karina kelly larissa leticia luana luciana marcela marina michele monica natalia nicole paula priscila rafaela raquel renata roberta sabrina sandra simone sonia tatiana thais vanessa vera viviane yasmin adriana andreia angela beatriz bianca cintia claudia denise elisa erica fatima gisele graziela ingrid jaqueline joyce karen lais lilian livia lorena luiza manuela marta mirela nathalia pamela rosana rosangela samara silvia sueli tania tereza valeria vitoria thalita talita cecilia regina rita lucia marcia jordana kamila kamilla taynara tayna tay thaynara thamires stefany stephanie bruna brenda barbara alessandra alice ariane aurea catarina clara daiane dayane edna eliana emily ester evelyn franciele gabrielly geovana heloisa iara irene isadora ivone janaina jessika josiane julyana kassia keila lara laura leila lidiane luana luciene maiara marilia mayara milena nadia nayara noemi olga pietra poliana rayane rebeca rosa sara scarlett solange stella suzana tamires valentina wanessa yara zilda ' +
  'joao jose carlos paulo pedro lucas marcos rafael bruno felipe gustavo rodrigo thiago tiago andre diego eduardo fabio fernando gabriel henrique igor leandro leonardo luis luiz marcelo mateus matheus ricardo roberto sergio vinicius wesley').split(/\s+/);
// Palavras que também são nomes mas aparecem no dia a dia (não trocar).
const NAO_TROCAR = new Set(['sofia', 'slim', 'slimfit', 'studio', 'fit', 'club', 'clube', 'aula', 'aulas', 'rosa', 'clara', 'gloria', 'vitoria', 'graca', 'luz', 'paz', 'mel', 'flor', 'bela', 'aurora', 'dia', 'alegria', 'serena', 'esperanca', 'vida', 'neves', 'mar', 'sol', 'lua', 'estrela', 'bom', 'boa', 'free', 'express', 'circuito', 'evo', 'whatsapp', 'instagram', 'google', 'pix', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'deus', 'jesus', 'senhor', 'nossa', 'oi', 'ola', 'obrigada', 'obrigado', 'personal', 'setor', 'bueno', 'goiania', 'brasilia', 'park', 'sul', 'norte', 'lago', 'guara', 'dores', 'branca', 'fe', 'santa', 'socorro', 'mae', 'tia', 'vo', 'dona']);

// ── dados da unidade ─────────────────────────────────────────────────────────
const conversas = lerJson(path.join(SOFIA, 'sofia-conversas.json'), {});
const tagLog = lerJsonl(path.join(SOFIA, 'sofia-tag-log.jsonl'));
const encerradas = lerJson(path.join(SOFIA, 'sofia-encerradas.json'), {});
const mapa = contatos.carregar();
const hist = lerJson(path.join(DATA, 'experimentais-historico.json'), {});
const ativas = lerJson(path.join(DATA, 'alunas-ativas-historico.json'), {});

// Léxico de nomes reais conhecidos (para trocar também quem é CITADO na conversa).
const LEXICO = new Set(COMUNS);
const addNome = (n) => { for (const p of semAcento(n).toLowerCase().split(/[^a-z]+/)) if (p.length >= 3 && !NAO_TROCAR.has(p)) LEXICO.add(p); };
for (const a of Object.values((hist && hist.aulas) || {})) { if (a && a.prof) addNome(a.prof); if (a && a.nome) addNome(String(a.nome).split(/\s+/)[0]); }
for (const p of Object.values((ativas && ativas.pessoas) || {})) if (p && p.n) addNome(String(p.n).split(/\s+/)[0]);
for (const m of Object.values(conversas)) for (const x of (m.msgs || [])) if (x.por) addNome(x.por);

function tagsDe(chave, conv) {
  const r = contatos.acharPorTel(chave, mapa) || (conv && conv.jid ? contatos.acharPorTel(String(conv.jid).split('@')[0], mapa) : null);
  return { contato: r ? r.contato : null, tags: (r && r.contato && r.contato.tags) || [] };
}

// ── anonimização ─────────────────────────────────────────────────────────────
function anonimizador(conv, contato, fict) {
  const reais = new Map(); // token real (normalizado) → fictício
  const nomeReal = [contato && contato.nome, conv.nome].filter(Boolean).join(' ');
  const partes = semAcento(nomeReal).toLowerCase().split(/[^a-z]+/).filter(p => p.length >= 2 && !['de', 'da', 'do', 'das', 'dos', 'e'].includes(p));
  partes.forEach((p, i) => { if (!reais.has(p)) reais.set(p, i === 0 ? fict.primeiro : FICT_SOBRENOMES[(hash(p) + i) % FICT_SOBRENOMES.length]); });
  const outro = (tok) => { const k = norm(tok); if (!reais.has(k)) reais.set(k, FICT_NOMES[hash(k) % FICT_NOMES.length]); return reais.get(k); };
  const casar = (orig, novo) => (orig === orig.toUpperCase() && orig.length > 1 ? novo.toUpperCase() : (orig[0] === orig[0].toLowerCase() ? novo.toLowerCase() : novo));
  let trocas = 0;
  const conta = (s) => { trocas++; return s; };
  const texto = (t) => {
    let s = String(t || '');
    s = s.replace(/https?:\/\/\S+|www\.\S+/gi, () => conta('https://link.exemplo.com'));
    s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, () => conta(`${norm(fict.primeiro)}.${norm(fict.sobrenome)}@exemplo.com`));
    s = s.replace(/(^|\s)@[\w.]{3,}/g, (m, a) => conta(a + '@exemplo'));
    s = s.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, () => conta('000.000.000-00'));
    s = s.replace(/(\+?55\s?)?\(?\b\d{2}\)?\s?9?\s?\d{4}[-.\s]?\d{4}\b/g, () => conta('(62) 90000-0000'));
    s = s.replace(/\b\d{5}-\d{3}\b/g, () => conta('00000-000'));
    s = s.replace(/\b(\d{1,2})\/(\d{1,2})\/(19\d{2}|200\d|201[0-5])\b/g, () => conta('01/01/1990'));
    s = s.replace(/\b\d{6,}\b/g, (m) => conta('0'.repeat(m.length)));
    // Linha que é só o nome completo em minúsculas ("gisele xavier prado") → nome fictício.
    s = s.split('\n').map(l => {
      const ws = l.trim().split(/\s+/);
      if (ws.length >= 2 && ws.length <= 6 && /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/.test(l.trim()) && partes.includes(norm(ws[0]))) return conta('\u0001NOME\u0001');
      return l;
    }).join('\n');
    // Nomes: os da própria pessoa em qualquer grafia; os demais só com inicial maiúscula.
    // Depois de um nome trocado, as palavras com inicial maiúscula em seguida são sobrenome.
    const re = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
    let out = '', ult = 0, m, cadeia = false, fimNome = -1;
    while ((m = re.exec(s))) {
      const w = m[0], k = norm(w), maiuscula = w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase();
      const entre = s.slice(ult, m.index);
      let novo = w;
      const continua = cadeia && fimNome === ult && /^ +$/.test(entre);
      if (k.length < 2 || /^(sofia|slim)/.test(k)) { /* mantém */ }
      else if (continua && ['de', 'da', 'do', 'das', 'dos', 'e'].includes(k)) { novo = w; out += entre + novo; ult = m.index + w.length; fimNome = ult; continue; }
      else if (continua && maiuscula && !NAO_TROCAR.has(k)) novo = casar(w, FICT_SOBRENOMES[hash(k) % FICT_SOBRENOMES.length]);
      else if (partes.includes(k) && (maiuscula || !NAO_TROCAR.has(k))) novo = casar(w, reais.get(k));
      else if (NAO_TROCAR.has(k)) { /* mantém */ }
      else if (reais.has(k) && maiuscula) novo = casar(w, reais.get(k));
      else if (k.length >= 3 && LEXICO.has(k) && maiuscula) novo = casar(w, outro(w));
      if (novo !== w) { conta(); cadeia = true; fimNome = m.index + w.length; } else cadeia = false;
      out += entre + novo; ult = m.index + w.length;
    }
    s = (out + s.slice(ult)).replace(/\u0001NOME\u0001/g, `${fict.primeiro} ${fict.sobrenome}`);
    return s;
  };
  return { texto, trocas: () => trocas };
}

// ── escolhe as conversas ─────────────────────────────────────────────────────
const candidatas = [];
const diag = { total: 0, comContato: 0, tamanhoOk: 0, tags: new Map() };
let fict = 0;
for (const [chave, conv] of Object.entries(conversas)) {
  diag.total++;
  if (/^556290000\d{4}$/.test(String(chave).replace(/\D/g, ''))) { fict++; continue; } // conversa da demonstração, não é real
  const msgs = (conv && conv.msgs) || [];
  const nS = msgs.filter(m => m.autor === 'sofia').length, nA = msgs.filter(m => m.autor === 'aluna').length;
  const { contato, tags } = tagsDe(chave, conv);
  if (contato) diag.comContato++;
  if (msgs.length < 6 || nS < 2 || nA < 2) continue;
  diag.tamanhoOk++;
  for (const t of tags) diag.tags.set(t, (diag.tags.get(t) || 0) + 1);
  const ks = tags.map(chaveTag);
  const alvo = TAGS.filter(t => ks.includes(chaveTag(t)));
  if (!alvo.length) continue;
  candidatas.push({ chave, conv, contato, tags, alvo, nota: Math.min(nS, 25) + Math.min(nA, 25) + (msgs.filter(m => m.autor === 'humano').length > nS ? -20 : 0) });
}
console.log(`Conversas da SoFIA: ${diag.total} (${path.join(SOFIA, 'sofia-conversas.json')})`);
if (fict) console.log(`⚠️  ${fict} conversa(s) desta pasta são da DEMONSTRAÇÃO (telefones 90000-xxxx) — foram gravadas aqui por engano. Veja demo-limpar-sofia-real.js.`);
console.log(`Contatos no CRM: ${Object.keys(mapa || {}).length} (${contatos.ARQUIVO})`);
console.log(`Conversas ligadas a um contato: ${diag.comContato} · com tamanho bom: ${diag.tamanhoOk} · com as tags pedidas: ${candidatas.length}`);
if (!candidatas.length) {
  console.log('\nTags que aparecem nas conversas com tamanho bom:');
  [...diag.tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([t, n]) => console.log(`   ${String(n).padStart(4)}  ${t}`));
}
console.log('');
candidatas.sort((a, b) => b.nota - a.nota);
const escolhidas = [], usadas = new Set();
for (const t of TAGS) {
  let n = escolhidas.filter(e => e.alvo.includes(t)).length;
  for (const c of candidatas) {
    if (n >= POR_TAG) break;
    if (usadas.has(c.chave) || !c.alvo.includes(t)) continue;
    usadas.add(c.chave); escolhidas.push(c); n++;
  }
}

const saida = [];
escolhidas.forEach((c, i) => {
  const num = i + 1;
  const primeiro = FICT_NOMES[(hash(c.chave) + i) % FICT_NOMES.length];
  const sobrenome = FICT_SOBRENOMES[hash(c.chave + 's') % FICT_SOBRENOMES.length];
  const an = anonimizador(c.conv, c.contato, { primeiro, sobrenome });
  const equipe = new Map();
  const msgs = (c.conv.msgs || []).map(m => {
    const o = { autor: m.autor, texto: an.texto(m.texto), em: m.em };
    if (m.tipo) o.tipo = m.tipo;
    if (m.citacao) o.citacao = an.texto(m.citacao);
    if (m.por) { if (!equipe.has(m.por)) equipe.set(m.por, FICT_EQUIPE[4 - (equipe.size % 5)]); o.por = equipe.get(m.por); }
    if (m.foto && !o.texto) o.texto = '📷 (foto)';
    return o;
  });
  // imagem que a SoFIA mandou: mostra a grade fictícia quando a conversa fala de grade/horários
  msgs.forEach((m, j) => {
    if (m.autor !== 'sofia' || !/imagem enviada/i.test(m.texto)) return;
    const viz = [msgs[j - 1], msgs[j + 1]].filter(Boolean).map(x => x.texto).join(' ');
    if (/grade|hor[aá]rio/i.test(viz)) { m.foto = 'grade-demo.png'; m.texto = ''; }
  });
  const eventos = tagLog.filter(e => e && e.chave === c.chave && e.tag).map(e => ({ tag: e.tag, motivo: e.motivo || '', acao: e.acao || 'add', em: e.em, ...(e.canal ? { canal: e.canal } : {}), ...(e.tacao ? { tacao: e.tacao } : {}) }));
  const enc = encerradas[c.chave];
  const reg = { num, nome: primeiro, tags: c.tags, msgs, eventos, encerrada: enc ? { em: enc.em, por: 'SoFIA' } : null };
  if (EXCLUIR.has(num)) { console.log(`  ✖ ${num}. excluída (${c.alvo.join(', ')})`); return; }
  saida.push(reg);
  const prev = (msgs.find(m => m.autor === 'aluna') || {}).texto || '';
  console.log(`  ${String(num).padStart(2)}. ${primeiro.padEnd(9)} ${String(msgs.length).padStart(3)} msgs · ${c.alvo.join(' + ')} · ${an.trocas()} trocas · "${prev.slice(0, 60).replace(/\n/g, ' ')}"`);
});

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, JSON.stringify({ geradoEm: new Date().toISOString(), conversas: saida }));
console.log(`\n✅ ${saida.length} conversas reais (anonimizadas) em ${SAIDA}`);
for (const t of TAGS) console.log(`   ${t}: ${saida.filter(s => s.tags.map(chaveTag).includes(chaveTag(t))).length}`);
console.log('\nAgora gere a demonstração:  cd /root/slimfit-exemplo/Experimental && node src/demo-dados.js');
console.log('Revise as conversas no painel de demonstração. Para tirar alguma: rode de novo com --excluir <números>.');
