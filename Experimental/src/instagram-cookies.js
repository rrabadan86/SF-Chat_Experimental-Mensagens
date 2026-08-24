/**
 * instagram-cookies.js — importar/checar os cookies do Instagram pelo painel.
 *
 * O VPS não loga no Instagram na mão: usamos a sessão do PC via cookies
 * exportados (extensão "Cookie-Editor" → instagram.com logado → Export → JSON).
 * Antes isso ia por SSH (scp). Agora dá para colar no painel (aba Instagram).
 *
 * O arquivo (instagram-cookies.json na raiz) contém o sessionid = ACESSO À
 * CONTA. É sensível: fica no .gitignore e nunca é exibido de volta no painel.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = process.env.IG_COOKIES_FILE || path.resolve(__dirname, '..', 'instagram-cookies.json');

function extrairLista(obj) {
  if (Array.isArray(obj)) return obj;
  if (obj && Array.isArray(obj.cookies)) return obj.cookies;
  return null;
}

// Status para o painel — SÓ metadados, nunca os valores dos cookies.
function status() {
  try {
    const lista = extrairLista(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))) || [];
    const validos = lista.filter(c => c && c.name && c.value);
    return {
      existe: true,
      quantidade: validos.length,
      temSessionId: validos.some(c => c.name === 'sessionid'),
      atualizadoEm: fs.statSync(ARQUIVO).mtime.toISOString(),
    };
  } catch (_) {
    return { existe: false, quantidade: 0, temSessionId: false, atualizadoEm: null };
  }
}

// Valida e grava o JSON colado. Lança Error com mensagem amigável se algo faltar.
function salvar(texto) {
  let obj;
  try { obj = JSON.parse(texto); }
  catch (_) { throw new Error('JSON inválido — cole o conteúdo exportado do Cookie-Editor (começa com "[").'); }
  const lista = extrairLista(obj);
  if (!lista) throw new Error('Formato inesperado — esperava uma lista de cookies (Cookie-Editor).');
  const validos = lista.filter(c => c && c.name && c.value).map(c => ({
    name: c.name, value: c.value,
    domain: c.domain || '.instagram.com', path: c.path || '/',
    secure: c.secure !== false, httpOnly: !!c.httpOnly,
  }));
  if (!validos.length) throw new Error('Nenhum cookie válido encontrado no texto colado.');
  if (!validos.some(c => c.name === 'sessionid')) {
    throw new Error('Faltou o cookie "sessionid" (o que dá acesso à conta). Exporte TODOS os cookies estando logada no instagram.com.');
  }
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(validos, null, 2), 'utf8');
  return validos.length;
}

module.exports = { ARQUIVO, status, salvar };
