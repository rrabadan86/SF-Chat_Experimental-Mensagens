/**
 * Copiar a configuração de uma unidade para outra (WhatsApp → Configuração →
 * "Copiar configuração para outra unidade").
 *
 * Um arquivo .json leva: textos das mensagens do robô, imagens das mensagens,
 * horários/dias dos envios, tags e automações, roteiro (prompt) e script de
 * integração da SoFIA e o follow-up da SoFIA.
 *
 * NÃO leva o que é de cada unidade: números de WhatsApp de aviso, campanhas,
 * áudios das professoras, grupos, EVO/.env, contatos e conversas. Na importação,
 * as tags são MESCLADAS (as da unidade que não estão no pacote ficam) e os números
 * de aviso de cada tag continuam os da unidade.
 *
 * Antes de importar, o estado atual é guardado em data/config-backups/ e o botão
 * "Desfazer a última importação" volta exatamente como estava.
 */
const fs = require('fs');
const path = require('path');
const mensagens = require('./mensagens');
const contatos = require('./contatos');
const horarios = require('./horarios');
const sofia = require('./sofia-editor');

const DATA = path.resolve(__dirname, '..', 'data');
const BKP_DIR = path.join(DATA, 'config-backups');
const TIPO = 'slimfit-config';

const PARTES = [
  ['mensagens', 'Textos das mensagens do robô'],
  ['fotos', 'Imagens das mensagens'],
  ['horarios', 'Horários e dias dos envios'],
  ['tags', 'Tags e automações (sem os números de aviso)'],
  ['prompt', 'Roteiro (prompt) da SoFIA'],
  ['extracao', 'Script de integração da SoFIA'],
  ['followup', 'Follow-up da SoFIA (tempo, janela e instrução)'],
];

function lerJson(f, padrao) { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return (o && typeof o === 'object') ? o : padrao; } catch (_) { return padrao; } }
function gravarJson(f, o) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf8'); fs.renameSync(tmp, f);
}
const nSecoes = (txt) => (String(txt || '').match(/^# /gm) || []).length + (String(txt || '').trim() && !/^# /.test(String(txt).trim()) ? 1 : 0);

// ── Exportar ────────────────────────────────────────────────────────────────
function exportar(unidade, { fotos = true } = {}) {
  const tags = {};
  for (const [t, c] of Object.entries(contatos.lerTagsConfig() || {})) {
    const x = { ...(c || {}) }; delete x.avisarWpp; delete x.campanhaId; tags[t] = x;
  }
  let fu = null; try { const f = sofia.lerFollowupCfg(); fu = { horas: f.horas, instrucao: f.instrucao, janelaIni: f.janelaIni, janelaFim: f.janelaFim, tagsExcluir: f.tagsExcluir }; } catch (_) {}
  const partes = {
    mensagens: lerJson(mensagens.ARQUIVO, {}),
    horarios: lerJson(horarios.ARQUIVO, {}),
    tags,
    prompt: sofia.textoPrompt(),
    extracao: sofia.textoExtracao(),
    ...(fu ? { followup: fu } : {}),
  };
  if (fotos) { try { partes.fotos = mensagens.exportarFotos(unidade).fotos || {}; } catch (_) {} }
  return { tipo: TIPO, versao: 1, unidade: unidade || '', em: new Date().toISOString(), partes };
}

// ── Prévia: o que o pacote traz × o que existe aqui ─────────────────────────
function validar(pac) {
  if (!pac || pac.tipo !== TIPO || !pac.partes || typeof pac.partes !== 'object') throw new Error('Este arquivo não é um pacote de configuração (baixe em "Baixar a configuração desta unidade" no painel de origem).');
}
function resumoParte(k, v) {
  if (v == null) return '';
  if (k === 'mensagens') { const val = new Set(mensagens.CATALOGO.map(m => m.chave)); return `${Object.keys(v).filter(x => val.has(x)).length} mensagem(ns) com texto editado`; }
  if (k === 'fotos') return `${Object.keys(v).length} imagem(ns)`;
  if (k === 'horarios') return `${Object.keys(v).length} envio(s) com horário próprio`;
  if (k === 'tags') return `${Object.keys(v).length} tag(s)`;
  if (k === 'prompt') return String(v).trim() ? `${nSecoes(v)} seção(ões), ${String(v).length.toLocaleString('pt-BR')} caracteres` : '';
  if (k === 'extracao') return String(v).trim() ? `${String(v).length.toLocaleString('pt-BR')} caracteres` : '';
  if (k === 'followup') return `${v.horas}h depois, das ${v.janelaIni} às ${v.janelaFim}`;
  return '';
}
function previa(pac) {
  validar(pac);
  const aqui = exportar('', { fotos: true });
  return {
    unidade: pac.unidade || '', em: pac.em || '',
    partes: PARTES.map(([k, rot]) => ({ chave: k, rotulo: rot, tem: pac.partes[k] != null && resumoParte(k, pac.partes[k]) !== '', pacote: resumoParte(k, pac.partes[k]), aqui: resumoParte(k, aqui.partes[k]) || 'nada' })),
  };
}

// ── Backup (estado cru, com números de aviso) e restauração ─────────────────
function snapshot(comFotos) {
  const s = {
    mensagens: lerJson(mensagens.ARQUIVO, {}),
    horarios: lerJson(horarios.ARQUIVO, {}),
    tags: contatos.lerTagsConfig() || {},
    prompt: sofia.textoPrompt(),
    extracao: sofia.textoExtracao(),
    followupCfg: sofia.textoFollowupCfg(),
  };
  if (comFotos) { try { s.fotos = mensagens.exportarFotos('').fotos || {}; } catch (_) { s.fotos = {}; } }
  return s;
}
function guardarBackup(s, origem, usuario) {
  fs.mkdirSync(BKP_DIR, { recursive: true });
  const arq = path.join(BKP_DIR, `antes-de-importar-${Date.now()}.json`);
  fs.writeFileSync(arq, JSON.stringify({ em: new Date().toISOString(), origem: origem || '', usuario: usuario || '', estado: s }), 'utf8');
  const todos = fs.readdirSync(BKP_DIR).filter(f => f.endsWith('.json')).sort();
  for (const f of todos.slice(0, Math.max(0, todos.length - 5))) { try { fs.unlinkSync(path.join(BKP_DIR, f)); } catch (_) {} }
  return arq;
}
function ultimoBackup() {
  try {
    const todos = fs.readdirSync(BKP_DIR).filter(f => f.endsWith('.json')).sort();
    if (!todos.length) return null;
    const arq = path.join(BKP_DIR, todos[todos.length - 1]);
    const o = JSON.parse(fs.readFileSync(arq, 'utf8'));
    return { arq, em: o.em, origem: o.origem, usuario: o.usuario, estado: o.estado };
  } catch (_) { return null; }
}
function restaurarFotos(fotos) {
  for (const m of mensagens.CATALOGO) {
    if (!mensagens.aceitaFoto(m.chave)) continue;
    if (fotos[m.chave]) { try { mensagens.salvarFoto(m.chave, fotos[m.chave]); } catch (_) {} }
    else if (mensagens.fotoPath(m.chave)) { try { mensagens.removerFoto(m.chave); } catch (_) {} }
  }
}

// ── Importar ────────────────────────────────────────────────────────────────
// escolhidas: chaves de PARTES. Devolve { feito: [rótulos], horarios: bool, tags: bool }.
function importar(pac, escolhidas, usuario) {
  validar(pac);
  const P = pac.partes;
  const sel = new Set((escolhidas || []).filter(k => PARTES.some(([c]) => c === k) && P[k] != null));
  if (!sel.size) throw new Error('Escolha pelo menos uma parte para importar.');
  guardarBackup(snapshot(sel.has('fotos')), pac.unidade, usuario);
  const feito = [];
  const rot = (k) => (PARTES.find(([c]) => c === k) || [])[1];
  // O roteiro é validado primeiro: se estiver quebrado, nada é aplicado.
  if (sel.has('prompt') && String(P.prompt || '').trim()) { sofia.importarPrompt(String(P.prompt)); feito.push(rot('prompt')); }

  if (sel.has('mensagens')) {
    const validas = new Set(mensagens.CATALOGO.map(m => m.chave));
    const o = {}; for (const [k, v] of Object.entries(P.mensagens || {})) if (validas.has(k) && typeof v === 'string') o[k] = v;
    gravarJson(mensagens.ARQUIVO, o); feito.push(rot('mensagens'));
  }
  if (sel.has('fotos')) { mensagens.importarFotos({ fotos: P.fotos || {} }, { substituir: true }); feito.push(rot('fotos')); }
  if (sel.has('horarios')) {
    const validas = new Set(horarios.CATALOGO.map(j => j.chave));
    const o = {}; for (const [k, v] of Object.entries(P.horarios || {})) if (validas.has(k) && String(v).trim().split(/\s+/).length === 5) o[k] = String(v).trim();
    gravarJson(horarios.ARQUIVO, o); feito.push(rot('horarios'));
  }
  if (sel.has('tags')) {
    const atual = contatos.lerTagsConfig() || {};
    const novo = { ...atual };
    for (const [t, c] of Object.entries(P.tags || {})) {
      const x = { ...(c || {}) }; delete x.avisarWpp; delete x.campanhaId;
      const daqui = atual[t] || {};
      if (daqui.avisarWpp) x.avisarWpp = daqui.avisarWpp;   // número de aviso é da unidade
      if (daqui.campanhaId) x.campanhaId = daqui.campanhaId;
      novo[t] = x;
    }
    contatos.salvarTagsConfig(novo); feito.push(rot('tags'));
  }
  const txt = {};
  if (sel.has('extracao') && String(P.extracao || '').trim()) { txt.extracao = String(P.extracao); feito.push(rot('extracao')); }
  if (sel.has('followup') && P.followup) {
    let on = false; try { on = !!sofia.lerFollowupCfg().on; } catch (_) {}
    sofia.gravarFollowupCfg({ on, ...P.followup }); feito.push(rot('followup')); // liga/desliga continua o daqui
  }
  if (Object.keys(txt).length) sofia.gravarTextosSofia(txt);
  return { feito, horarios: sel.has('horarios'), tags: sel.has('tags') };
}

function desfazer() {
  const b = ultimoBackup();
  if (!b || !b.estado) throw new Error('Não há importação para desfazer.');
  const s = b.estado;
  gravarJson(mensagens.ARQUIVO, s.mensagens || {});
  gravarJson(horarios.ARQUIVO, s.horarios || {});
  contatos.salvarTagsConfig(s.tags || {});
  sofia.gravarTextosSofia({ prompt: s.prompt, extracao: s.extracao, followupCfg: s.followupCfg });
  if (s.fotos) restaurarFotos(s.fotos);
  try { fs.unlinkSync(b.arq); } catch (_) {}
  return { em: b.em, origem: b.origem };
}

module.exports = { exportar, previa, importar, desfazer, ultimoBackup, PARTES };
