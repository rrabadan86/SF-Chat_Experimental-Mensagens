/**
 * unidades-rede.js — lista das unidades da rede para a tela de ACESSO ÚNICO
 * (/unidades): o administrador escolhe a unidade, entra, e cai no painel dela.
 *
 * A lista (nome + endereço do painel de cada unidade) fica em
 * data/unidades-rede.json e só o administrador edita (Perfis → Unidades).
 *
 * Segurança: esta tela NÃO confere senha nem cria sessão. Ela só manda o
 * formulário de login para o painel da unidade escolhida, que confere a senha
 * como sempre. Por isso o endereço precisa ser https (a senha viaja por ele) e
 * só entra na lista o que o administrador cadastrou.
 */
const fs = require('fs');
const path = require('path');

const ARQ = path.resolve(__dirname, '..', 'data', 'unidades-rede.json');
const MAX = 20;

// "painel.unidade.com.br" / "https://painel.unidade.com.br/qualquer/coisa" → "https://painel.unidade.com.br"
function normalizarUrl(u) {
  let t = String(u || '').trim();
  if (!t) throw new Error('endereço vazio');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'https://' + t;
  let o;
  try { o = new URL(t); } catch (_) { throw new Error(`"${String(u).slice(0, 60)}" não é um endereço válido`); }
  const local = o.hostname === 'localhost' || o.hostname === '127.0.0.1';
  if (o.protocol !== 'https:' && !(o.protocol === 'http:' && local)) throw new Error(`"${o.host}": o endereço precisa começar com https://`);
  if (o.username || o.password) throw new Error(`"${o.host}": o endereço não pode ter usuário ou senha`);
  if (!o.hostname || (!local && !o.hostname.includes('.'))) throw new Error(`"${String(u).slice(0, 60)}" não é um endereço válido`);
  return o.origin;
}

// Uma unidade por linha: "Nome | endereço". Linhas vazias são ignoradas.
function deTexto(texto) {
  const lista = [], vistos = new Set();
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) continue;
    const i = linha.indexOf('|');
    if (i < 0) throw new Error(`Linha "${linha.slice(0, 50)}": use o formato Nome | endereço`);
    const nome = linha.slice(0, i).replace(/\s+/g, ' ').trim();
    if (!nome) throw new Error(`Linha "${linha.slice(0, 50)}": faltou o nome da unidade`);
    if (nome.length > 40) throw new Error(`"${nome.slice(0, 20)}…": o nome pode ter até 40 letras`);
    const url = normalizarUrl(linha.slice(i + 1));
    if (vistos.has(url)) throw new Error(`O endereço ${url} está repetido`);
    vistos.add(url);
    lista.push({ nome, url });
  }
  if (lista.length > MAX) throw new Error(`No máximo ${MAX} unidades`);
  return lista;
}
function paraTexto(lista) { return (lista || []).map(u => `${u.nome} | ${u.url}`).join('\n'); }

// Sempre devolve uma lista já conferida (arquivo mexido à mão com endereço ruim é ignorado).
function ler() {
  let bruto = [];
  try { bruto = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (_) { return []; }
  if (!Array.isArray(bruto)) return [];
  const out = [];
  for (const u of bruto.slice(0, MAX)) {
    try { const nome = String((u && u.nome) || '').trim().slice(0, 40); if (nome) out.push({ nome, url: normalizarUrl(u.url) }); } catch (_) {}
  }
  return out;
}
function salvarTexto(texto) {
  const lista = deTexto(texto);
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  const tmp = ARQ + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lista, null, 1));
  fs.renameSync(tmp, ARQ);
  return lista;
}

module.exports = { ARQ, MAX, normalizarUrl, deTexto, paraTexto, ler, salvarTexto };
