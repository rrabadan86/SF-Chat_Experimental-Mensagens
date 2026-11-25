/**
 * auth.js — senha do painel e sessão, sem dependência externa.
 *
 * Senha: guardada como scrypt (salt aleatório por senha), nunca em texto.
 *   Gere o hash com  npm run senha  e cole em ADMIN_SENHA_HASH no .env.
 *
 * Sessão: cookie assinado com HMAC. Não é JWT nem banco de sessão — para um
 * painel de um usuário só, um cookie assinado com prazo resolve e não traz
 * biblioteca nenhuma junto.
 */
const crypto = require('crypto');

const VALIDADE_HORAS = Number(process.env.ADMIN_SESSAO_HORAS || 12);
const COOKIE = 'painel';

function segredo() {
  const s = process.env.ADMIN_SEGREDO;
  if (!s || s.length < 16) {
    throw new Error(
      'Defina ADMIN_SEGREDO no .env com pelo menos 16 caracteres aleatórios ' +
      '(é o que assina o cookie do painel). Gere um com: npm run senha'
    );
  }
  return s;
}

// ------------------------------------------------------------------- senha

function gerarHash(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function conferirSenha(senha, guardado) {
  if (!guardado) return false;
  const [algoritmo, salt, hash] = String(guardado).split('$');
  if (algoritmo !== 'scrypt' || !salt || !hash) return false;
  const tentativa = crypto.scryptSync(String(senha || ''), salt, 64);
  const esperado = Buffer.from(hash, 'hex');
  if (tentativa.length !== esperado.length) return false;
  return crypto.timingSafeEqual(tentativa, esperado);   // comparação de tempo constante
}

// ------------------------------------------------------------------ sessão

function assinar(dados) {
  return crypto.createHmac('sha256', segredo()).update(dados).digest('base64url');
}

function criarToken() {
  const corpo = Buffer.from(JSON.stringify({
    exp: Date.now() + VALIDADE_HORAS * 3600000,
    n: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

function tokenValido(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [corpo, assinatura] = token.split('.');
  const esperada = Buffer.from(assinar(corpo));
  const recebida = Buffer.from(String(assinatura));
  if (esperada.length !== recebida.length) return false;
  if (!crypto.timingSafeEqual(esperada, recebida)) return false;
  try {
    return JSON.parse(Buffer.from(corpo, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ cookies

function lerCookie(req, nome) {
  const cru = req.headers.cookie || '';
  for (const parte of cru.split(';')) {
    const [k, ...resto] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(resto.join('='));
  }
  return null;
}

function definirCookie(res, token, seguro) {
  const partes = [
    `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${VALIDADE_HORAS * 3600}`,
  ];
  if (seguro) partes.push('Secure');
  res.append('Set-Cookie', partes.join('; '));
}

function limparCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function estaAutenticado(req) {
  return tokenValido(lerCookie(req, COOKIE));
}

/** Barra a rota se não houver sessão válida. */
function exigirSessao(req, res, next) {
  if (estaAutenticado(req)) return next();
  res.status(401).json({ erro: 'Sessão expirada. Entre de novo.', codigo: 'sem_sessao' });
}

// -------------------------------------------------- freio de força bruta

const tentativas = new Map();
const JANELA_MS = 15 * 60000;
const LIMITE = 8;

function podeTentar(ip) {
  const agora = Date.now();
  const marcas = (tentativas.get(ip) || []).filter((m) => agora - m < JANELA_MS);
  tentativas.set(ip, marcas);
  return marcas.length < LIMITE;
}

function registrarFalha(ip) {
  const marcas = tentativas.get(ip) || [];
  marcas.push(Date.now());
  tentativas.set(ip, marcas);
}

function limparTentativas(ip) {
  tentativas.delete(ip);
}

module.exports = {
  COOKIE, gerarHash, conferirSenha, criarToken, tokenValido,
  lerCookie, definirCookie, limparCookie, estaAutenticado, exigirSessao,
  podeTentar, registrarFalha, limparTentativas, VALIDADE_HORAS,
};
