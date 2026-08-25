/**
 * sofia-editor.js — lê/grava os arquivos da Sofia (o chatbot em ../../ChatBot),
 * para a aba "🤖 Sofia" do painel editar o prompt e as configs SEM tocar em
 * código e sem reiniciar (a Sofia lê os arquivos a cada conversa).
 *
 * Substitui o antigo ChatBot/editor.ts (telinha separada) — a mesma lógica de
 * seções (# ...), extração, mídias, estado on/off e pausa, agora no painel.
 *
 * A pasta da Sofia é configurável (SOFIA_DIR); o padrão é a pasta ChatBot do
 * mesmo repositório. Se ela não existir nesta máquina, disponivel() é false.
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.SOFIA_DIR || path.resolve(__dirname, '..', '..', 'ChatBot');
const F = {
  prompt: path.join(DIR, 'sofia-prompt.txt'),
  promptBak: path.join(DIR, 'sofia-prompt.bak.txt'),
  extracao: path.join(DIR, 'sofia-extracao.txt'),
  extracaoBak: path.join(DIR, 'sofia-extracao.bak.txt'),
  estado: path.join(DIR, 'sofia-estado.txt'),
  pausa: path.join(DIR, 'sofia-pausa-min.txt'),
  sessao: path.join(DIR, 'sofia-sessao-horas.txt'), // janela de memória da conversa (horas) — lida pela Sofia
  midias: path.join(DIR, 'sofia-midias.txt'),
  ritmo: path.join(DIR, 'sofia-ritmo.json'), // "jeito humano" (velocidade/pausas) — lido pelo listener
  waStatus: path.join(DIR, 'sofia-wa-status.json'), // publicado pelo listener da Sofia
  conversas: path.join(DIR, 'sofia-conversas.json'), // inbox — publicado pelo listener
  respostas: path.join(DIR, 'sofia-respostas.jsonl'), // fila de respostas do painel → listener envia
};

// Padrões do "jeito humano" (mesmos do listener). O painel edita e o listener lê
// este arquivo a cada mensagem — muda sem reiniciar.
const RITMO_PADRAO = { humano: true, msPorChar: 45, delayMin: 1200, delayMax: 4500 };

function ler(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }
function existe(p) { try { return fs.existsSync(p); } catch (_) { return false; } }

// Semeadura: prompt/extração/mídias são editáveis pelo painel e ficam FORA do Git.
// O conteúdo base mora nos sofia-*.default.txt (versionados). Se o arquivo "vivo"
// sumir (clone novo ou git pull), recriamos a partir do .default — assim o painel
// nunca mostra vazio e o "git pull" e o painel nunca conflitam.
function comDefault(p) { return p.replace(/\.txt$/, '.default.txt'); }
function semear() {
  for (const vivo of [F.prompt, F.extracao, F.midias]) {
    try { const base = comDefault(vivo); if (!existe(vivo) && existe(base)) fs.copyFileSync(base, vivo); } catch (_) {}
  }
}
function disponivel() { semear(); return existe(DIR) && existe(F.prompt); }

// ── estado (on/off) e pausa (minutos de atendimento humano) ─────────────────
function estadoAtivo() { return ler(F.estado).trim().toLowerCase() !== 'off'; }
function gravarEstado(ativo) { fs.writeFileSync(F.estado, ativo ? 'on' : 'off', 'utf8'); }
function lerPausaMin() { const n = parseInt(ler(F.pausa).trim(), 10); return Number.isFinite(n) && n > 0 ? n : 30; }
function gravarPausaMin(n) { fs.writeFileSync(F.pausa, String(n), 'utf8'); }

// ── janela de sessão (memória da conversa), em HORAS ────────────────────────
// Padrão 12h (mesmo da Sofia). Depois desse tempo sem mensagens, a próxima
// mensagem começa uma conversa nova (a Sofia não lembra do que foi dito antes).
const SESSAO_HORAS_PADRAO = 12;
function lerSessaoHoras() {
  const n = parseFloat(ler(F.sessao).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 720) : SESSAO_HORAS_PADRAO;
}
function gravarSessaoHoras(h) {
  const n = parseFloat(String(h).replace(',', '.'));
  const val = Number.isFinite(n) && n > 0 ? Math.min(n, 720) : SESSAO_HORAS_PADRAO;
  fs.writeFileSync(F.sessao, String(val), 'utf8');
}

// ── mídias (URLs de imagens de preços/grade) ────────────────────────────────
function lerMidias() {
  const d = { grade_imagem: '', grade_link: '', precos_imagem: '', precos_link: '' };
  for (const l of ler(F.midias).split('\n')) {
    const i = l.indexOf('=');
    if (i > 0) { const k = l.slice(0, i).trim(); if (k in d) d[k] = l.slice(i + 1).trim(); }
  }
  return d;
}
function gravarMidias(m) {
  const txt = 'grade_imagem=' + (m.grade_imagem || '') + '\n'
    + 'grade_link=' + (m.grade_link || '') + '\n'
    + 'precos_imagem=' + (m.precos_imagem || '') + '\n'
    + 'precos_link=' + (m.precos_link || '') + '\n';
  fs.writeFileSync(F.midias, txt, 'utf8');
}

// ── ritmo ("jeito humano": velocidade de digitação e pausas) ────────────────
function inteiro(v, padrao) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : padrao; }
function lerRitmo() {
  let o = {};
  try { const p = JSON.parse(ler(F.ritmo)); if (p && typeof p === 'object') o = p; } catch (_) {}
  const humano = (o.humano === undefined) ? RITMO_PADRAO.humano : (o.humano !== false);
  let msPorChar = Math.max(0, Math.min(500, inteiro(o.msPorChar, RITMO_PADRAO.msPorChar)));
  let delayMin = Math.max(0, Math.min(60000, inteiro(o.delayMin, RITMO_PADRAO.delayMin)));
  let delayMax = Math.max(0, Math.min(60000, inteiro(o.delayMax, RITMO_PADRAO.delayMax)));
  if (delayMax < delayMin) delayMax = delayMin; // coerência: máximo nunca menor que o mínimo
  return { humano, msPorChar, delayMin, delayMax };
}
function gravarRitmo(r) {
  const atual = lerRitmo();
  const novo = {
    humano: (r.humano === undefined) ? atual.humano : (r.humano !== false),
    msPorChar: Math.max(0, Math.min(500, inteiro(r.msPorChar, atual.msPorChar))),
    delayMin: Math.max(0, Math.min(60000, inteiro(r.delayMin, atual.delayMin))),
    delayMax: Math.max(0, Math.min(60000, inteiro(r.delayMax, atual.delayMax))),
  };
  if (novo.delayMax < novo.delayMin) novo.delayMax = novo.delayMin;
  fs.writeFileSync(F.ritmo, JSON.stringify(novo, null, 2), 'utf8');
}

// ── prompt em seções (linhas que começam com "# ") ──────────────────────────
function parseSecoes(texto) {
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const secoes = []; let atual = null; const intro = [];
  for (const l of linhas) {
    if (l.startsWith('# ')) { if (atual) secoes.push(atual); atual = { titulo: l.slice(2).trim(), corpo: '' }; }
    else if (atual) { atual.corpo += (atual.corpo ? '\n' : '') + l; }
    else { intro.push(l); }
  }
  if (atual) secoes.push(atual);
  const introTxt = intro.join('\n').trim();
  if (introTxt) secoes.unshift({ titulo: 'IDENTIDADE / ABERTURA', corpo: introTxt });
  return secoes;
}
function montarPrompt(secoes) {
  return secoes.map((s, i) => {
    const corpo = (s.corpo || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    if (i === 0 && s.titulo === 'IDENTIDADE / ABERTURA') return corpo;
    return '# ' + s.titulo + '\n' + corpo;
  }).join('\n\n').trim() + '\n';
}

// Estado completo para a página.
function estado() {
  return {
    disponivel: disponivel(),
    dir: DIR,
    ativa: estadoAtivo(),
    pausaMin: lerPausaMin(),
    sessaoHoras: lerSessaoHoras(),
    secoes: parseSecoes(ler(F.prompt)),
    extracao: ler(F.extracao),
    midias: lerMidias(),
    ritmo: lerRitmo(),
  };
}

// Salva tudo (com backup e validação mínima). Lança Error em caso de recusa.
function salvar({ secoes, extracao, pausaMin, sessaoHoras, midias, ritmo }) {
  const promptMontado = montarPrompt(secoes || []);
  const ext = String(extracao || '').trim();
  if (promptMontado.trim().length < 50 || ext.length < 30) {
    throw new Error('Algum campo essencial ficou curto demais — confira e tente de novo.');
  }
  try { if (existe(F.prompt)) fs.copyFileSync(F.prompt, F.promptBak); } catch (_) {}
  try { if (existe(F.extracao)) fs.copyFileSync(F.extracao, F.extracaoBak); } catch (_) {}
  fs.writeFileSync(F.prompt, promptMontado, 'utf8');
  fs.writeFileSync(F.extracao, ext, 'utf8');
  gravarPausaMin(Math.max(1, Math.min(1440, parseInt(pausaMin, 10) || 30)));
  if (sessaoHoras !== undefined) gravarSessaoHoras(sessaoHoras);
  gravarMidias(midias || {});
  if (ritmo) gravarRitmo(ritmo);
}

function restaurar() {
  let ok = false;
  try { if (existe(F.promptBak)) { fs.copyFileSync(F.promptBak, F.prompt); ok = true; } } catch (_) {}
  try { if (existe(F.extracaoBak)) { fs.copyFileSync(F.extracaoBak, F.extracao); ok = true; } } catch (_) {}
  return ok;
}

// Conexão do WhatsApp da Sofia (publicada pelo listener em sofia-wa-status.json).
function waStatus() {
  try { const o = JSON.parse(ler(F.waStatus)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}

// Inbox de conversas (publicado pelo listener). Devolve objeto { chave: {jid,nome,ultimaEm,msgs[]} }.
function conversas() {
  try { const o = JSON.parse(ler(F.conversas)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
// Enfileira uma resposta do painel para o listener enviar (Parte 2 usa isto).
function enfileirarResposta(chave, jid, texto) {
  const linha = JSON.stringify({ chave, jid, texto: String(texto || ''), em: Date.now() }) + '\n';
  fs.appendFileSync(F.respostas, linha, 'utf8');
}

module.exports = {
  disponivel, estado, salvar, restaurar, estadoAtivo, gravarEstado,
  lerPausaMin, gravarPausaMin, lerSessaoHoras, gravarSessaoHoras, lerRitmo, gravarRitmo, waStatus,
  conversas, enfileirarResposta, DIR, ARQUIVOS: F,
};
