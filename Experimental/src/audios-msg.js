/**
 * Áudios por professora, enviados como MENSAGEM DE VOZ depois do texto.
 *
 * Editados no painel (WhatsApp → Configuração, bloco "🎙️ Áudio da professora"
 * nos cards). Cada GRUPO vale para um ou mais cards:
 *   - followup:    Follow-up pós-aula (ainda não fechou) e (já virou aluna)
 *   - confirmacao_hoje:   Confirmação — aula de hoje
 *   - confirmacao_amanha: Confirmação — aula de amanhã (áudio próprio: fala "amanhã")
 *
 * Arquivos: data/mensagens-audios/<grupo>/<professora>.<ext>, onde <professora>
 * é o 1º nome sem acento (como o robô casa a professora da aula: "Taynara Reges"
 * → taynara). O nome completo fica em data/mensagens-audios/nomes.json só para
 * mostrar no painel.
 *
 * O WhatsApp só toca como nota de voz o OGG/Opus. Se o servidor tiver ffmpeg, o
 * áudio enviado (mp3, m4a, wav…) é convertido na hora; sem ffmpeg, só .ogg/.opus
 * vão como voz (os outros formatos vão como arquivo de áudio).
 *
 * Follow-up: os áudios antigos da pasta audios/ (AUDIO_MAP do .env; sem ele, o
 * mapa padrão do Setor Bueno — ver config.js) são COPIADOS uma vez para o painel
 * (data/mensagens-audios/followup/) e passam a ser áudios normais: dá para
 * trocar e REMOVER. Depois disso a pasta antiga não é mais consultada.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.resolve(__dirname, '..', 'data', 'mensagens-audios');
const NOMES = path.join(DIR, 'nomes.json');
const EXTS = ['.ogg', '.opus', '.oga', '.m4a', '.aac', '.mp3', '.wav'];
const VOZ = /\.(ogg|opus|oga)$/i;

const GRUPOS = {
  followup: { titulo: 'Follow-up pós-aula', chaves: ['followup', 'followup_aluna'], legado: true },
  confirmacao_hoje: { titulo: 'Confirmação — aula de hoje', chaves: ['confirmacao_hoje'], legado: false },
  confirmacao_amanha: { titulo: 'Confirmação — aula de amanhã', chaves: ['confirmacao_amanha'], legado: false },
};

// Antes, hoje e amanhã dividiam a pasta "confirmacao". Copia o que houver para as
// duas (cada uma passa a ter o seu e pode ser trocado à parte) e aposenta a antiga.
(function migrarConfirmacao() {
  const velha = path.join(DIR, 'confirmacao');
  try {
    if (!fs.existsSync(velha)) return;
    for (const g of ['confirmacao_hoje', 'confirmacao_amanha']) {
      const nova = path.join(DIR, g);
      fs.mkdirSync(nova, { recursive: true });
      for (const f of fs.readdirSync(velha)) { const dest = path.join(nova, f); if (!fs.existsSync(dest)) fs.copyFileSync(path.join(velha, f), dest); }
    }
    fs.renameSync(velha, velha + '.migrado');
  } catch (_) {}
})();

// Áudios antigos (pasta audios/ + AUDIO_MAP) → áudios do painel, UMA vez. Marca
// com .legado-migrado para não recopiar o que a unidade remover depois.
const LEGADO_FLAG = path.join(DIR, '.legado-migrado');
function migrarLegado() {
  try {
    if (fs.existsSync(LEGADO_FLAG)) return;
    const cfg = require('./config').audio;
    const nomes = lerNomes();
    let n = 0;
    const copiados = new Set(); // apelidos (ex.: "bia" e "beatriz" → o mesmo arquivo): copia uma vez só
    for (const slug of Object.keys((cfg && cfg.map) || {})) {
      if (arquivoPainel('followup', slug)) continue;
      const leg = arquivoLegado(slug);
      if (!leg || copiados.has(leg)) continue;
      copiados.add(leg);
      // prefere o .ogg (vai como nota de voz) quando o legado tem os dois
      const ogg = leg.replace(/\.[^.]+$/, '.ogg');
      const src = fs.existsSync(ogg) ? ogg : leg;
      const dest = path.join(DIR, 'followup', slug + path.extname(src).toLowerCase());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      if (!nomes[slug]) nomes[slug] = slug.charAt(0).toUpperCase() + slug.slice(1);
      n++;
    }
    if (n) gravarNomes(nomes);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(LEGADO_FLAG, new Date().toISOString() + ` — ${n} áudio(s) antigo(s) copiado(s) para o painel\n`);
  } catch (_) {}
}
function legadoAtivo() { return !fs.existsSync(LEGADO_FLAG); }

function grupoDaChave(chave) {
  for (const g of Object.keys(GRUPOS)) if (GRUPOS[g].chaves.includes(chave)) return g;
  return '';
}

// "Taynara Reges" → "taynara"
function slugProf(nome) {
  return String(nome || '').trim().split(/\s+/)[0]
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lerNomes() {
  try { const o = JSON.parse(fs.readFileSync(NOMES, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; }
}
function gravarNomes(o) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(NOMES, JSON.stringify(o, null, 2)); } catch (_) {}
}

function arquivoPainel(grupo, slug) {
  if (!GRUPOS[grupo] || !slug) return null;
  const base = path.join(DIR, grupo);
  for (const ext of EXTS) { const p = path.join(base, slug + ext); if (fs.existsSync(p)) return p; }
  return null;
}

// Áudio antigo do follow-up (pasta audios/ + AUDIO_MAP), pelo 1º nome.
function arquivoLegado(slug) {
  let cfg;
  try { cfg = require('./config').audio; } catch (_) { return null; }
  const prefixo = cfg && cfg.map ? cfg.map[slug] : null;
  if (!prefixo) return null;
  for (const ext of EXTS) { const p = path.join(cfg.dir, prefixo + ext); if (fs.existsSync(p)) return p; }
  try {
    const files = fs.readdirSync(cfg.dir);
    for (const ext of EXTS) {
      const f = files.find(x => x.toLowerCase().startsWith(String(prefixo).toLowerCase()) && x.toLowerCase().endsWith(ext));
      if (f) return path.join(cfg.dir, f);
    }
  } catch (_) {}
  return null;
}

/** Caminho do áudio para a professora da aula (ou null). Usado pelos envios. */
function caminho(grupo, professora) {
  migrarLegado();
  const slug = slugProf(professora);
  if (!slug) return null;
  return arquivoPainel(grupo, slug) || (GRUPOS[grupo] && GRUPOS[grupo].legado && legadoAtivo() ? arquivoLegado(slug) : null);
}

function temFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch (_) { return false; }
}

/** Lista para o painel: [{ slug, nome, arquivo, origem: 'painel'|'sistema'|'', voz }]. */
function listar(grupo, professorasConhecidas) {
  migrarLegado();
  const nomes = lerNomes();
  const porSlug = new Map();
  const add = (nome) => { const s = slugProf(nome); if (s && !porSlug.has(s)) porSlug.set(s, String(nome).trim()); };
  (professorasConhecidas || []).forEach(add);
  try { for (const f of fs.readdirSync(path.join(DIR, grupo))) { const s = f.replace(/\.[^.]+$/, ''); if (!porSlug.has(s)) porSlug.set(s, nomes[s] || s); } } catch (_) {}
  if (GRUPOS[grupo] && GRUPOS[grupo].legado && legadoAtivo()) {
    try { for (const s of Object.keys(require('./config').audio.map || {})) if (!porSlug.has(s) && arquivoLegado(s)) porSlug.set(s, nomes[s] || s.charAt(0).toUpperCase() + s.slice(1)); } catch (_) {}
  }
  const out = [];
  const conhecidas = new Set((professorasConhecidas || []).map(slugProf));
  const legadosVistos = new Set();
  for (const [slug, nome] of porSlug) {
    const p = arquivoPainel(grupo, slug);
    const l = !p && GRUPOS[grupo] && GRUPOS[grupo].legado && legadoAtivo() ? arquivoLegado(slug) : null;
    // Apelidos do AUDIO_MAP (ex.: "bia" e "beatriz" → o mesmo arquivo): mostra uma vez só.
    if (l && !conhecidas.has(slug) && legadosVistos.has(l)) continue;
    if (l) legadosVistos.add(l);
    const arq = p || l;
    out.push({ slug, nome: nomes[slug] || nome, arquivo: arq ? path.basename(arq) : '', origem: p ? 'painel' : (l ? 'sistema' : ''), voz: arq ? VOZ.test(arq) : false });
  }
  return out.sort((a, b) => (b.origem ? 1 : 0) - (a.origem ? 1 : 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Salva o áudio de uma professora (dataUrl "data:audio/...;base64,..." + nome do
 * arquivo original). Converte para OGG/Opus quando há ffmpeg. → { arquivo, voz }
 */
function salvar(grupo, professora, dataUrl, nomeArquivo) {
  if (!GRUPOS[grupo]) throw new Error('mensagem sem áudio');
  const slug = slugProf(professora);
  if (!slug) throw new Error('informe o nome da professora');
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('arquivo de áudio inválido');
  const buf = Buffer.from(m[3], m[2] ? 'base64' : 'utf8');
  if (!buf.length) throw new Error('arquivo vazio');
  if (buf.length > 16 * 1024 * 1024) throw new Error('áudio muito grande (máx. 16 MB)');
  let ext = path.extname(String(nomeArquivo || '')).toLowerCase();
  if (!EXTS.includes(ext)) {
    const tipo = (m[1] || '').toLowerCase();
    ext = /ogg|opus/.test(tipo) ? '.ogg' : /mpeg|mp3/.test(tipo) ? '.mp3' : /mp4|m4a|aac/.test(tipo) ? '.m4a' : /wav/.test(tipo) ? '.wav' : '';
  }
  if (!ext) throw new Error('formato não suportado (use .ogg, .mp3, .m4a ou .wav)');
  const base = path.join(DIR, grupo);
  fs.mkdirSync(base, { recursive: true });
  const tmp = path.join(base, `.${slug}.envio${ext}`);
  fs.writeFileSync(tmp, buf);
  let final = '';
  if (temFfmpeg()) {
    const ogg = path.join(base, `.${slug}.conv.ogg`);
    try {
      execFileSync('ffmpeg', ['-y', '-i', tmp, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', ogg], { stdio: 'ignore', timeout: 120000 });
      if (fs.existsSync(ogg) && fs.statSync(ogg).size > 0) final = ogg;
    } catch (_) { try { fs.unlinkSync(ogg); } catch (_) {} }
  }
  const destExt = final ? '.ogg' : ext;
  remover(grupo, slug, { manterNome: true });
  const dest = path.join(base, slug + destExt);
  fs.renameSync(final || tmp, dest);
  try { if (final) fs.unlinkSync(tmp); } catch (_) {}
  const nomes = lerNomes(); nomes[slug] = String(professora).trim(); gravarNomes(nomes);
  return { arquivo: path.basename(dest), voz: VOZ.test(dest), convertido: !!final };
}

function remover(grupo, profOuSlug, { manterNome } = {}) {
  if (!GRUPOS[grupo]) return;
  const slug = slugProf(profOuSlug);
  for (const ext of EXTS) { try { fs.unlinkSync(path.join(DIR, grupo, slug + ext)); } catch (_) {} }
  if (!manterNome) { /* o nome fica guardado para o caso de subir de novo */ }
}

module.exports = { GRUPOS, DIR, grupoDaChave, slugProf, caminho, listar, salvar, remover, temFfmpeg, arquivoPainel, arquivoLegado, legadoAtivo, migrarLegado, VOZ };
