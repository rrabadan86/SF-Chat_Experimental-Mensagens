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

// Telas que dá para liberar por usuário. A Sofia é dividida em três (Conversas,
// Configuração e Contatos) para dar acesso fino. "Perfis" é só do admin.
const TELAS = [
  { key: 'ind', rot: '📈 Formulário' },
  { key: 'msg_config', rot: '⚙️ Configuração', grupo: '💬 WhatsApp' },
  { key: 'msg_agendar', rot: '📅 Agendamento', grupo: '💬 WhatsApp' },
  { key: 'msg_hoje', rot: '📊 Log', grupo: '💬 WhatsApp' },
  { key: 'ig', rot: '📸 Instagram' },
  { key: 'sofia_conversas', rot: '💬 Conversas', grupo: '🤖 Sofia' },
  { key: 'sofia_config', rot: '⚙️ Configuração', grupo: '🤖 Sofia' },
  { key: 'sofia_contatos', rot: '📇 Contatos', grupo: '🤖 Sofia' },
  { key: 'sofia_campanhas', rot: '📣 Campanhas', grupo: '🤖 Sofia' },
];
const TELAS_KEYS = TELAS.map(t => t.key);
// Chaves "legado" (abas inteiras) que expandem para as sub-telas ao salvar.
const LEGADO = { sofia: ['sofia_conversas', 'sofia_config', 'sofia_contatos', 'sofia_campanhas'], msg: ['msg_config', 'msg_agendar', 'msg_hoje'], hoje: ['msg_hoje'] };

function normU(u) { return String(u == null ? '' : u).trim().toLowerCase(); }
function normEmail(e) { return String(e == null ? '' : e).trim().toLowerCase(); }
function emailValido(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e)); }
function limparTelas(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  const out = [];
  for (let t of arr) {
    t = normU(t);
    if (LEGADO[t]) { for (const k of LEGADO[t]) if (!out.includes(k)) out.push(k); continue; } // legado → expande
    if (TELAS_KEYS.includes(t) && !out.includes(t)) out.push(t);
  }
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
function semSenha(c) { return { usuario: c.usuario, email: c.email || '', admin: !!c.admin, telas: c.telas || [], criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm }; }

function listar() {
  return Object.values(carregar()).map(semSenha).sort((a, b) => a.usuario.localeCompare(b.usuario, 'pt-BR'));
}
function existe(usuario) { return !!carregar()[normU(usuario)]; }
function obter(usuario) { const c = carregar()[normU(usuario)]; return c ? semSenha(c) : null; }

// Garante que um e-mail não está em uso por OUTRO usuário (ignora o próprio).
function emailEmUso(map, email, exceto) {
  const e = normEmail(email); if (!e) return false;
  for (const k in map) { if (k === normU(exceto)) continue; if (normEmail(map[k].email) === e) return true; }
  return false;
}
function criar({ usuario, senha, telas, email, admin }) {
  const u = normU(usuario);
  if (!u || u.length < 3) throw new Error('Usuário precisa de pelo menos 3 caracteres.');
  if (!/^[a-z0-9._-]+$/.test(u)) throw new Error('Use só letras, números, ponto, hífen ou sublinhado no usuário.');
  if (!senha || String(senha).length < 4) throw new Error('A senha precisa de pelo menos 4 caracteres.');
  const em = normEmail(email);
  if (em && !emailValido(em)) throw new Error('E-mail inválido.');
  const map = carregar();
  if (map[u]) throw new Error('Já existe um usuário com esse nome.');
  if (em && emailEmUso(map, em)) throw new Error('Esse e-mail já está em outro usuário.');
  // Admin vê tudo — as telas ficam vazias (não são usadas quando admin=true).
  map[u] = { usuario: u, email: em, senha: hashSenha(senha), admin: !!admin, telas: admin ? [] : limparTelas(telas), criadoEm: Date.now(), atualizadoEm: Date.now() };
  salvar(map);
  return semSenha(map[u]);
}
// Promove/rebaixa um usuário a administrador (vê tudo + gerencia Perfis).
function definirAdmin(usuario, ativo) {
  const map = carregar(); const u = normU(usuario);
  if (!map[u]) return false;
  map[u].admin = !!ativo;
  if (ativo) map[u].telas = []; // admin não usa telas específicas
  map[u].atualizadoEm = Date.now();
  salvar(map); return true;
}
// Define/limpa o e-mail de um usuário (para login com Google). Vazio = remove.
function definirEmail(usuario, email) {
  const map = carregar(); const u = normU(usuario);
  if (!map[u]) return false;
  const em = normEmail(email);
  if (em && !emailValido(em)) throw new Error('E-mail inválido.');
  if (em && emailEmUso(map, em, u)) throw new Error('Esse e-mail já está em outro usuário.');
  map[u].email = em; map[u].atualizadoEm = Date.now();
  salvar(map); return true;
}
// Acha o usuário dono de um e-mail (case-insensitive). Devolve sem o hash, ou null.
function porEmail(email) {
  const e = normEmail(email); if (!e) return null;
  const map = carregar();
  for (const k in map) if (normEmail(map[k].email) === e) return semSenha(map[k]);
  return null;
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
  TELAS, TELAS_KEYS, normU, normEmail, emailValido, listar, existe, obter, criar,
  definirTelas, definirSenha, definirEmail, definirAdmin, porEmail, remover, verificar, ARQUIVO,
};
