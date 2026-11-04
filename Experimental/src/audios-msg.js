/**
 * Áudios por professora, enviados como MENSAGEM DE VOZ depois do texto.
 *
 * Editados no painel (WhatsApp → Configuração, bloco "🎙️ Áudio da professora"
 * nos cards). Cada GRUPO vale para um ou mais cards:
 *   - followup:    Follow-up pós-aula (ainda não fechou) e (já virou aluna)
 *   - confirmacao: Confirmação — aula de hoje e aula de amanhã
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
 * Follow-up: se a professora não tem áudio no painel, vale o áudio antigo da
 * pasta audios/ (AUDIO_MAP do .env) — nada muda para quem já usa.
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
  confirmacao: { titulo: 'Confirmação da aula', chaves: ['confirmacao_hoje', 'confirmacao_amanha'], legado: false },
};

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
  const slug = slugProf(professora);
  if (!slug) return null;
  return arquivoPainel(grupo, slug) || (GRUPOS[grupo] && GRUPOS[grupo].legado ? arquivoLegado(slug) : null);
}

function temFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 }); return true; } catch (_) { return false; }
}

/** Lista para o painel: [{ slug, nome, arquivo, origem: 'painel'|'sistema'|'', voz }]. */
function listar(grupo, professorasConhecidas) {
  const nomes = lerNomes();
  const porSlug = new Map();
  const add = (nome) => { const s = slugProf(nome); if (s && !porSlug.has(s)) porSlug.set(s, String(nome).trim()); };
  (professorasConhecidas || []).forEach(add);
  try { for (const f of fs.readdirSync(path.join(DIR, grupo))) { const s = f.replace(/\.[^.]+$/, ''); if (!porSlug.has(s)) porSlug.set(s, nomes[s] || s); } } catch (_) {}
  if (GRUPOS[grupo] && GRUPOS[grupo].legado) {
    try { for (const s of Object.keys(require('./config').audio.map || {})) if (!porSlug.has(s) && arquivoLegado(s)) porSlug.set(s, nomes[s] || s.charAt(0).toUpperCase() + s.slice(1)); } catch (_) {}
  }
  const out = [];
  const conhecidas = new Set((professorasConhecidas || []).map(slugProf));
  const legadosVistos = new Set();
  for (const [slug, nome] of porSlug) {
    const p = arquivoPainel(grupo, slug);
    const l = !p && GRUPOS[grupo] && GRUPOS[grupo].legado ? arquivoLegado(slug) : null;
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

module.exports = { GRUPOS, DIR, grupoDaChave, slugProf, caminho, listar, salvar, remover, temFfmpeg, arquivoPainel, arquivoLegado, VOZ };
