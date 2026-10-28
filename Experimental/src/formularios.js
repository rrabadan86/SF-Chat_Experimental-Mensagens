/**
 * formularios.js — formulários de campanha montados no painel (ex.: lista de
 * interessadas na Black Friday).
 *
 * A recepção cria o formulário em Formulário → Campanhas (título, texto, imagem
 * de capa e as perguntas que quiser). Cada formulário ganha um link público
 * (/formulario/<endereço>) e as respostas ficam numa lista no painel, com
 * WhatsApp de cada pessoa e exportação em planilha. Nome e WhatsApp são sempre
 * pedidos; quem responde de novo com o mesmo número ATUALIZA a resposta (não
 * duplica). Se o formulário tiver uma tag, a pessoa entra nos Contatos da SoFIA
 * com ela — dá para disparar uma Campanha só para essa lista depois.
 *
 * Dados desta unidade (gitignored): data/formularios.json,
 * data/formularios-respostas.json e data/formularios-capas/<id>.jpg.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ARQ_FORMS = path.join(DATA_DIR, 'formularios.json');
const ARQ_RESP = path.join(DATA_DIR, 'formularios-respostas.json');
const CAPAS_DIR = path.join(DATA_DIR, 'formularios-capas');
const CAPA_MAX_BYTES = 1024 * 1024; // a página do painel reduz a imagem antes de enviar
const MAX_CAMPOS = 30, MAX_OPCOES = 30;

// Tipos de pergunta (além de nome e WhatsApp, que todo formulário tem).
const TIPOS = {
  texto: 'Resposta curta',
  paragrafo: 'Resposta longa',
  unica: 'Escolha uma opção',
  varias: 'Pode marcar várias',
  data: 'Data',
  email: 'E-mail',
};
const COM_OPCOES = new Set(['unica', 'varias']);

const MODELO_BLACK_FRIDAY = {
  titulo: 'Black Friday SlimFit',
  descricao: 'Entre na lista VIP e receba as ofertas da Black Friday antes de todo mundo, direto no seu WhatsApp.\nAs vagas com desconto são limitadas.',
  campos: [
    { tipo: 'unica', rotulo: 'Você já é aluna da SlimFit?', obrigatorio: true, opcoes: ['Sou aluna', 'Já fui aluna', 'Ainda não'] },
    { tipo: 'varias', rotulo: 'O que te interessa?', obrigatorio: false, opcoes: ['Plano mensal', 'Plano semestral', 'Plano anual', 'Avaliação física'] },
    { tipo: 'unica', rotulo: 'Melhor horário para treinar', obrigatorio: false, opcoes: ['Manhã', 'Almoço', 'Tarde', 'Noite'] },
  ],
  botao: 'Quero entrar na lista',
  msgFinal: 'Pronto, você está na lista! Assim que as ofertas forem liberadas, a gente te chama no WhatsApp.',
  tag: 'Black Friday',
  slug: 'blackfriday',
};

const novoId = () => crypto.randomBytes(8).toString('hex');
const idCampo = () => 'c' + crypto.randomBytes(4).toString('hex');
const corta = (s, n) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim().slice(0, n);

function lerJson(arq, padrao) {
  try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o && typeof o === 'object' ? o : padrao; }
  catch (_) { return padrao; }
}
function gravarJson(arq, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = arq + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, arq); // troca atômica: nunca fica meio arquivo
}
function carregarForms() { const o = lerJson(ARQ_FORMS, {}); return Array.isArray(o.forms) ? o.forms : []; }
function salvarForms(forms) { gravarJson(ARQ_FORMS, { forms }); }
function carregarResp() { return lerJson(ARQ_RESP, {}); }
function salvarResp(map) { gravarJson(ARQ_RESP, map); }

// "Black Friday 2026!" → "black-friday-2026"
function normSlug(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
function slugLivre(base, ignorarId, forms) {
  let s = base || 'formulario', n = 2;
  while (forms.some(f => f.slug === s && f.id !== ignorarId)) s = (base || 'formulario').slice(0, 36) + '-' + n++;
  return s;
}

// Data de hoje em Brasília (AAAA-MM-DD), independente do fuso do servidor.
function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function estaAberto(f) { return !!(f && f.ativo && (!f.encerraEm || hojeBR() <= f.encerraEm)); }
function situacao(f) {
  if (!f.ativo) return 'pausado';
  if (f.encerraEm && hojeBR() > f.encerraEm) return 'encerrado';
  return 'aberto';
}

function obter(id) { return carregarForms().find(f => f.id === id) || null; }
function porSlug(slug) { const s = normSlug(slug); return s ? carregarForms().find(f => f.slug === s) || null : null; }
// O único formulário aberto (para o endereço curto /formulario), ou null.
function unicoAberto() { const a = carregarForms().filter(estaAberto); return a.length === 1 ? a[0] : null; }

function listar() {
  const resp = carregarResp();
  return carregarForms().slice()
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
    .map(f => Object.assign({}, f, { total: (resp[f.id] || []).length, situacao: situacao(f) }));
}

// ── Capa ────────────────────────────────────────────────────────────────────
function arqCapa(id) { return path.join(CAPAS_DIR, id + '.jpg'); }
function capaPath(id) {
  if (!/^[a-f0-9]{16}$/.test(String(id || ''))) return null;
  const p = arqCapa(id);
  return fs.existsSync(p) ? p : null;
}
// Só aceita JPEG de verdade (a página converte no canvas antes de enviar).
function decodificarCapa(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { erro: 'Imagem inválida. Use JPG ou PNG.' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > CAPA_MAX_BYTES) return { erro: 'A imagem passa de 1 MB. Escolha uma menor.' };
  if (buf.length < 1000 || !(buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)) return { erro: 'Não consegui ler essa imagem. Tente outra.' };
  return { buf };
}

// ── Criar / editar ──────────────────────────────────────────────────────────
function validarCampos(lista) {
  if (!Array.isArray(lista)) return { campos: [] };
  if (lista.length > MAX_CAMPOS) return { erro: `No máximo ${MAX_CAMPOS} perguntas.` };
  const campos = [], ids = new Set();
  for (const [i, c] of lista.entries()) {
    const tipo = TIPOS[c && c.tipo] ? c.tipo : 'texto';
    const rotulo = corta(c && c.rotulo, 200);
    if (!rotulo) return { erro: `A pergunta ${i + 1} está sem texto.` };
    let id = /^c[a-f0-9]{8}$/.test(String(c.id || '')) ? c.id : idCampo();
    if (ids.has(id)) id = idCampo();
    ids.add(id);
    const campo = { id, tipo, rotulo, obrigatorio: !!c.obrigatorio };
    if (COM_OPCOES.has(tipo)) {
      const ops = [...new Set((Array.isArray(c.opcoes) ? c.opcoes : String(c.opcoes || '').split('\n')).map(o => corta(o, 100)).filter(Boolean))];
      if (ops.length < 2) return { erro: `"${rotulo}": coloque pelo menos 2 opções (uma por linha).` };
      if (ops.length > MAX_OPCOES) return { erro: `"${rotulo}": no máximo ${MAX_OPCOES} opções.` };
      campo.opcoes = ops;
    }
    campos.push(campo);
  }
  return { campos };
}

// Cria (sem id) ou atualiza (com id). `d.capa`: dataURL nova, 'remover' ou vazio (mantém).
function salvar(d, id, por) {
  const forms = carregarForms();
  const atual = id ? forms.find(f => f.id === id) : null;
  if (id && !atual) return { erro: 'Formulário não encontrado.' };
  const titulo = corta(d.titulo, 120);
  if (!titulo) return { erro: 'Dê um título ao formulário.' };
  const vc = validarCampos(d.campos);
  if (vc.erro) return { erro: vc.erro };
  const encerraEm = /^\d{4}-\d{2}-\d{2}$/.test(String(d.encerraEm || '')) ? d.encerraEm : '';
  let capa = null;
  if (d.capa && d.capa !== 'remover') { capa = decodificarCapa(d.capa); if (capa.erro) return { erro: capa.erro }; }
  const fid = atual ? atual.id : novoId();
  const slugPedido = normSlug(d.slug) || normSlug(titulo);
  const outro = forms.find(f => f.slug === slugPedido && f.id !== fid);
  if (outro && normSlug(d.slug)) return { erro: `O endereço "${slugPedido}" já é usado pelo formulário "${outro.titulo}". Escolha outro.` };
  const agora = new Date().toISOString();
  const f = Object.assign(atual || { id: fid, criadoEm: agora, criadoPor: por || '' }, {
    titulo,
    descricao: corta(d.descricao, 2000),
    campos: vc.campos,
    botao: corta(d.botao, 40) || 'Enviar',
    msgFinal: corta(d.msgFinal, 500) || 'Recebemos sua resposta. Obrigada!',
    tag: corta(d.tag, 40).replace(/[,;]/g, ' ').trim(),
    ativo: d.ativo !== false,
    encerraEm,
    slug: slugLivre(slugPedido, fid, forms),
    atualizadoEm: agora,
  });
  if (capa) { fs.mkdirSync(CAPAS_DIR, { recursive: true }); fs.writeFileSync(arqCapa(fid), capa.buf); f.capa = true; f.capaV = Date.now(); }
  else if (d.capa === 'remover') { try { fs.unlinkSync(arqCapa(fid)); } catch (_) {} f.capa = false; }
  if (!atual) forms.push(f);
  salvarForms(forms);
  return { ok: true, form: f };
}

function definirAtivo(id, ativo) {
  const forms = carregarForms();
  const f = forms.find(x => x.id === id);
  if (!f) return false;
  f.ativo = !!ativo; f.atualizadoEm = new Date().toISOString();
  salvarForms(forms);
  return true;
}

function duplicar(id, por) {
  const f = obter(id);
  if (!f) return { erro: 'Formulário não encontrado.' };
  const r = salvar(Object.assign({}, f, { titulo: (f.titulo + ' (cópia)').slice(0, 120), slug: '', ativo: false, capa: '' }), null, por);
  if (r.ok && capaPath(f.id)) {
    fs.copyFileSync(arqCapa(f.id), arqCapa(r.form.id));
    const forms = carregarForms(); const n = forms.find(x => x.id === r.form.id);
    if (n) { n.capa = true; n.capaV = Date.now(); salvarForms(forms); }
  }
  return r;
}

function excluir(id) {
  const forms = carregarForms();
  const f = forms.find(x => x.id === id);
  if (!f) return null;
  salvarForms(forms.filter(x => x.id !== id));
  const resp = carregarResp(); delete resp[id]; salvarResp(resp);
  try { fs.unlinkSync(arqCapa(id)); } catch (_) {}
  return f;
}

// ── Respostas ───────────────────────────────────────────────────────────────
// Telefone BR com DDD → só dígitos com 55 (ou '' se não parecer celular/fixo).
function normTel(t) {
  let d = String(t == null ? '' : t).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? d : '';
}
// O mesmo número com e sem o 9º dígito (a pessoa pode digitar dos dois jeitos).
function chaveTel(tel) { const d = String(tel || ''); return d.slice(0, 4) + d.slice(-8); }

function validarResposta(f, d) {
  const nome = corta(d.nome, 80).replace(/\s+/g, ' ');
  if (nome.length < 2) return { erro: 'Digite seu nome.' };
  const telefone = normTel(d.telefone);
  if (!telefone) return { erro: 'Digite seu WhatsApp com DDD. Ex.: (61) 99999-9999.' };
  const valores = [];
  const v = (d.valores && typeof d.valores === 'object') ? d.valores : {};
  for (const c of f.campos || []) {
    let val = v[c.id];
    if (c.tipo === 'varias') {
      val = (Array.isArray(val) ? val : []).map(x => String(x)).filter(x => c.opcoes.includes(x));
      if (c.obrigatorio && !val.length) return { erro: `Responda: ${c.rotulo}` };
    } else {
      val = corta(val, c.tipo === 'paragrafo' ? 2000 : 300);
      if (c.tipo === 'unica' && val && !c.opcoes.includes(val)) val = '';
      if (c.tipo === 'data' && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) val = '';
      if (c.tipo === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return { erro: 'Confira o e-mail digitado.' };
      if (c.obrigatorio && !val) return { erro: `Responda: ${c.rotulo}` };
    }
    valores.push({ id: c.id, rotulo: c.rotulo, valor: val });
  }
  return { nome, telefone, valores };
}

// Grava a resposta. Mesmo número de novo → atualiza a resposta que já existia.
function responder(f, d) {
  const v = validarResposta(f, d);
  if (v.erro) return v;
  const resp = carregarResp();
  const lista = resp[f.id] || (resp[f.id] = []);
  const agora = new Date().toISOString();
  const k = chaveTel(v.telefone);
  const ja = lista.find(r => chaveTel(r.telefone) === k);
  // Reenvio: vale a resposta nova, mas guarda o número na forma completa (com o 9) se uma das duas tiver.
  if (ja) Object.assign(ja, { nome: v.nome, telefone: v.telefone.length >= String(ja.telefone).length ? v.telefone : ja.telefone, valores: v.valores, atualizadoEm: agora, vezes: (ja.vezes || 1) + 1 });
  else lista.push({ id: novoId(), em: agora, nome: v.nome, telefone: v.telefone, valores: v.valores, origem: corta(d.origem, 40) });
  salvarResp(resp);
  return { ok: true, novo: !ja, nome: v.nome, telefone: v.telefone };
}

function respostas(id) {
  return (carregarResp()[id] || []).slice().sort((a, b) => String(b.atualizadoEm || b.em).localeCompare(String(a.atualizadoEm || a.em)));
}
function excluirResposta(formId, respId) {
  const resp = carregarResp();
  const lista = resp[formId] || [];
  const i = lista.findIndex(r => r.id === respId);
  if (i < 0) return null;
  const [r] = lista.splice(i, 1);
  salvarResp(resp);
  return r;
}

// Colunas da lista: as perguntas atuais e, no fim, as que foram apagadas do
// formulário mas têm resposta guardada (nada some da planilha).
function colunas(f, lista) {
  const cols = (f.campos || []).map(c => ({ id: c.id, rotulo: c.rotulo }));
  const vistos = new Set(cols.map(c => c.id));
  for (const r of lista) for (const v of r.valores || []) if (!vistos.has(v.id)) { vistos.add(v.id); cols.push({ id: v.id, rotulo: v.rotulo + ' (removida)' }); }
  return cols;
}
function valorTexto(r, idCampo) {
  const v = (r.valores || []).find(x => x.id === idCampo);
  if (!v) return '';
  if (Array.isArray(v.valor)) return v.valor.join(', ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.valor)) { const [a, m, d] = v.valor.split('-'); return `${d}/${m}/${a}`; }
  return String(v.valor || '');
}
function fmtTel(t) {
  const d = String(t || '').replace(/^55/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : String(t || '');
}
function fmtQuando(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Planilha (CSV com ; e BOM — abre direto no Excel em português).
function csv(id) {
  const f = obter(id);
  if (!f) return null;
  const lista = respostas(id);
  const cols = colunas(f, lista);
  const cel = s => { s = String(s == null ? '' : s); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const linhas = [['Data', 'Nome', 'WhatsApp', ...cols.map(c => c.rotulo)].map(cel).join(';')];
  for (const r of lista) linhas.push([fmtQuando(r.atualizadoEm || r.em), r.nome, fmtTel(r.telefone), ...cols.map(c => valorTexto(r, c.id))].map(cel).join(';'));
  return '﻿' + linhas.join('\r\n') + '\r\n';
}

// Limite simples de envios por IP (protege a página pública de robôs).
const _tent = new Map();
function permitir(chave, max, janelaMs) {
  const agora = Date.now();
  if (_tent.size > 5000) _tent.clear();
  const arr = (_tent.get(chave) || []).filter(t => agora - t < janelaMs);
  if (arr.length >= max) { _tent.set(chave, arr); return false; }
  arr.push(agora); _tent.set(chave, arr);
  return true;
}

module.exports = {
  TIPOS, COM_OPCOES, MODELO_BLACK_FRIDAY, MAX_CAMPOS,
  listar, obter, porSlug, unicoAberto, estaAberto, situacao, salvar, definirAtivo, duplicar, excluir,
  capaPath, responder, respostas, excluirResposta, colunas, valorTexto, fmtTel, fmtQuando, csv, normSlug, permitir,
};
