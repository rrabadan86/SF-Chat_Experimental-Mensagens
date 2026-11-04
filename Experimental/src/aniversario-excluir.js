/**
 * Grupos que NÃO recebem o parabéns de aniversário (nos grupos).
 *
 * O robô manda o parabéns em todos os grupos em comum com a aniversariante;
 * os grupos listados aqui (editáveis no painel, card "Aniversário (nos grupos)")
 * são pulados. Guardado em data/aniversario-excluir.json. Lido a cada envio —
 * vale sem reiniciar.
 *
 * Comparação sem maiúsculas/acentos/emojis: o grupo é pulado se o nome dele for
 * igual ao escrito ou CONTIVER o texto escrito (ex.: "Equipe" pula
 * "Equipe SlimFit Bueno"). Mesmo critério do robô para achar grupo pelo nome.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'aniversario-excluir.json');
const MAX = 50;

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function listar() {
  try {
    const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) || {};
    return (Array.isArray(o.grupos) ? o.grupos : []).map(g => String(g).trim()).filter(Boolean);
  } catch (_) { return []; }
}

// Texto do painel (um grupo por linha; vírgula também separa) → lista gravada.
function salvar(texto) {
  const vistos = new Set();
  const grupos = String(texto || '').split(/[\n,;]+/).map(g => g.replace(/\s+/g, ' ').trim())
    .filter(g => { const n = norm(g); if (!n || vistos.has(n)) return false; vistos.add(n); return true; })
    .slice(0, MAX);
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify({ grupos }, null, 2));
  return grupos;
}

// Qual item da lista bloqueia este grupo (ou null se o grupo pode receber).
function bloqueadoPor(nomeGrupo, lista) {
  const n = norm(nomeGrupo);
  if (!n) return null;
  for (const g of (lista || listar())) {
    const e = norm(g);
    if (e && (n === e || (' ' + n + ' ').includes(' ' + e + ' '))) return g;
  }
  return null;
}

module.exports = { ARQUIVO, listar, salvar, bloqueadoPor, norm };
