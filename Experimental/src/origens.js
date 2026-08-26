/**
 * origens.js — canais de origem do "Gerador de links por origem" (aba Formulário).
 * Guardado em data/origens.json. Cada canal: { slug, rot, desc }. O link fica
 * <FORM>/?origem=<slug>; a contagem casa pelo slug (minúsculo). Começa com 4
 * canais padrão, mas o Studio pode CRIAR e EXCLUIR os seus pela telinha.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ARQUIVO = path.join(DATA_DIR, 'origens.json');

const PADRAO = [
  { slug: 'instagram', rot: '📸 Instagram', desc: 'Coloque na bio, nos stories e nos posts.' },
  { slug: 'whatsapp', rot: '💬 WhatsApp', desc: 'Envie nas conversas, status e grupos.' },
  { slug: 'indicacao', rot: '🤝 Indicação', desc: 'Para quando uma aluna indica uma amiga.' },
  { slug: 'propaganda', rot: '📣 Propaganda', desc: 'Anúncios pagos, panfletos e parcerias.' },
];

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); if (Array.isArray(o)) return o; } catch (_) {}
  return null;
}
function salvar(arr) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  fs.writeFileSync(ARQUIVO, JSON.stringify(arr, null, 2), 'utf8');
}

// Lista os canais (semeia os padrões na primeira vez).
function listar() {
  const atual = carregar();
  if (atual) return atual;
  salvar(PADRAO);
  return PADRAO.slice();
}

function criar({ rot, desc }) {
  rot = String(rot || '').trim();
  if (!rot) throw new Error('Dê um nome ao canal.');
  const slug = slugify(rot);
  if (!slug) throw new Error('Nome inválido — use letras ou números.');
  const arr = listar();
  if (arr.some(o => o.slug === slug)) throw new Error('Já existe um canal com esse nome/link.');
  arr.push({ slug, rot, desc: String(desc || '').trim() });
  salvar(arr);
  return { slug, rot };
}

function remover(slug) {
  slug = slugify(slug || '');
  const arr = listar();
  const n = arr.filter(o => o.slug !== slug);
  if (n.length === arr.length) return false;
  salvar(n);
  return true;
}

module.exports = { listar, criar, remover, slugify, PADRAO, ARQUIVO };
