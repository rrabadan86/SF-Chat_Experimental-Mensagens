/**
 * usuarios.js — usuários do painel (login por perfil) e quais telas cada um vê.
 * Guardado em data/usuarios.json (gitignored — tem hash de senha; dado sensível).
 *
 * O ADMIN do painel continua sendo o do .env (PAINEL_USER/PAINEL_SENHA): ele sempre
 * entra, vê tudo e é o único que gerencia os Perfis. Os usuários daqui são "comuns":
 * entram com usuário+senha e só enxergam as telas marcadas. Tudo vale na hora, sem
 * reiniciar (o painel lê o arquivo a cada requisição).
 *
 * Senha nunca é guardada em texto: usamos scrypt (embutido no Node) com sal por
 * usuário, e comparação em tempo constante.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ARQUIVO = path.join(DATA_DIR, 'usuarios.json');

// Telas que dá para liberar por usuário (as mesmas abas do painel; "Perfis" é só do admin).
const TELAS = [
  { key: 'hoje', rot: '📊 Hoje' },
  { key: 'ind', rot: '📈 Indicadores' },
  { key: 'msg', rot: '💬 WhatsApp' },
  { key: 'ig', rot: '📸 Instagram' },
  { key: 'sofia', rot: '🤖 Sofia' },
];
const TELAS_KEYS = TELAS.map(t => t.key);

function normU(u) { return String(u == null ? '' : u).trim().toLowerCase(); }
function limparTelas(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  const out = [];
  for (let t of arr) { t = normU(t); if (TELAS_KEYS.includes(t) && !out.includes(t)) out.push(t); }
  return out;
}

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvar(map) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  fs.writeFileSync(ARQUIVO, JSON.stringify(map, null, 2), 'utf8');
}

// ── senha (scrypt + sal por usuário) ────────────────────────────────────────
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(senha), salt, 32);
  return salt.toString('hex') + ':' + dk.toString('hex');
}
function conferirSenha(senha, armazenado) {
  try {
    const [s, h] = String(armazenado || '').split(':');
    if (!s || !h) return false;
    const dk = crypto.scryptSync(String(senha), Buffer.from(s, 'hex'), 32);
    const hb = Buffer.from(h, 'hex');
    return dk.length === hb.length && crypto.timingSafeEqual(dk, hb);
  } catch (_) { return false; }
}

// ── API pública (só o essencial; sem devolver o hash) ───────────────────────
function semSenha(c) { return { usuario: c.usuario, telas: c.telas || [], criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm }; }

function listar() {
  return Object.values(carregar()).map(semSenha).sort((a, b) => a.usuario.localeCompare(b.usuario, 'pt-BR'));
}
function existe(usuario) { return !!carregar()[normU(usuario)]; }
function obter(usuario) { const c = carregar()[normU(usuario)]; return c ? semSenha(c) : null; }

function criar({ usuario, senha, telas }) {
  const u = normU(usuario);
  if (!u || u.length < 3) throw new Error('Usuário precisa de pelo menos 3 caracteres.');
  if (!/^[a-z0-9._-]+$/.test(u)) throw new Error('Use só letras, números, ponto, hífen ou sublinhado no usuário.');
  if (!senha || String(senha).length < 4) throw new Error('A senha precisa de pelo menos 4 caracteres.');
  const map = carregar();
  if (map[u]) throw new Error('Já existe um usuário com esse nome.');
  map[u] = { usuario: u, senha: hashSenha(senha), telas: limparTelas(telas), criadoEm: Date.now(), atualizadoEm: Date.now() };
  salvar(map);
  return semSenha(map[u]);
}
function definirTelas(usuario, telas) {
  const map = carregar(); const u = normU(usuario);
  if (!map[u]) return false;
  map[u].telas = limparTelas(telas); map[u].atualizadoEm = Date.now();
  salvar(map); return true;
}
function definirSenha(usuario, senha) {
  if (!senha || String(senha).length < 4) throw new Error('A senha precisa de pelo menos 4 caracteres.');
  const map = carregar(); const u = normU(usuario);
  if (!map[u]) return false;
  map[u].senha = hashSenha(senha); map[u].atualizadoEm = Date.now();
  salvar(map); return true;
}
function remover(usuario) {
  const map = carregar(); const u = normU(usuario);
  if (!map[u]) return false;
  delete map[u]; salvar(map); return true;
}
// Confere login. Devolve o usuário (sem hash) ou null.
function verificar(usuario, senha) {
  const c = carregar()[normU(usuario)];
  if (!c) return null;
  return conferirSenha(senha, c.senha) ? semSenha(c) : null;
}

module.exports = {
  TELAS, TELAS_KEYS, normU, listar, existe, obter, criar,
  definirTelas, definirSenha, remover, verificar, ARQUIVO,
};
