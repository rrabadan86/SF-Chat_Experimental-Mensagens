/*
 * acessos.js — registro de acessos ao painel (tela Perfis).
 *
 * Guarda duas coisas, na pasta data/ (fora do Git; dado operacional):
 *  - ÚLTIMO ACESSO por usuário (acessos-ultimo.json = { "<usuario>": <ts> }):
 *    atualizado a cada requisição autenticada, mas com "trava de tempo" (só grava
 *    de novo depois de ALGUNS MINUTOS) — senão o refresh de 4s da aba Conversas
 *    escreveria em disco o tempo todo. Responde "quando fulano usou por último".
 *  - HISTÓRICO DE LOGINS (acessos-login.jsonl = uma linha por login):
 *    { usuario, em, metodo } com metodo "senha" | "google". Podado para o arquivo
 *    não crescer. Responde "quem entrou, quando e como".
 *
 * Sem IP nem navegador — só usuário e horário (opção escolhida no painel).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const F_ULT = path.join(DATA_DIR, 'acessos-ultimo.json');
const F_LOG = path.join(DATA_DIR, 'acessos-login.jsonl');

const THROTTLE_MS = 3 * 60 * 1000; // grava o "último acesso" no máx. 1x a cada 3 min por usuário
const LOG_MANTER = 500;            // quantas linhas de login manter
const LOG_CORTE = 650;             // poda quando passar disto

function _garantirDir() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {} }

// Cache em memória do mapa de últimos acessos (o painel é um processo só).
let _ult = null;
function _lerUlt() {
  if (_ult) return _ult;
  try { const o = JSON.parse(fs.readFileSync(F_ULT, 'utf8')); _ult = (o && typeof o === 'object') ? o : {}; }
  catch (_) { _ult = {}; }
  return _ult;
}
function _gravarUlt() { _garantirDir(); try { fs.writeFileSync(F_ULT, JSON.stringify(_ult)); } catch (_) {} }

// Marca atividade do usuário AGORA (chamado em toda requisição autenticada).
// Só escreve em disco se passou da trava de tempo — barato de chamar sempre.
function registrarAcesso(usuario) {
  const u = String(usuario || '').trim();
  if (!u) return;
  const m = _lerUlt();
  const agora = Date.now();
  if (agora - (Number(m[u]) || 0) < THROTTLE_MS) return; // gravou há pouco → ignora
  m[u] = agora;
  _gravarUlt();
}

// Instante do último acesso de um usuário (0 se nunca).
function ultimoAcesso(usuario) { return Number(_lerUlt()[String(usuario || '').trim()]) || 0; }
// Mapa { usuario: ts } (cópia) — para a tabela de Perfis.
function ultimosAcessos() { return Object.assign({}, _lerUlt()); }

// Registra um LOGIN (senha ou google). Conta também como "último acesso".
function registrarLogin(usuario, metodo) {
  const u = String(usuario || '').trim();
  if (!u) return;
  const rec = { usuario: u, em: Date.now(), metodo: metodo === 'google' ? 'google' : 'senha' };
  _garantirDir();
  try { fs.appendFileSync(F_LOG, JSON.stringify(rec) + '\n'); } catch (_) {}
  // login também é atividade → atualiza o último acesso na hora (sem trava)
  const m = _lerUlt(); m[u] = rec.em; _gravarUlt();
  _podar();
}

function _podar() {
  try {
    const linhas = fs.readFileSync(F_LOG, 'utf8').split('\n').filter(Boolean);
    if (linhas.length > LOG_CORTE) fs.writeFileSync(F_LOG, linhas.slice(-LOG_MANTER).join('\n') + '\n');
  } catch (_) {}
}

// Últimos N logins, do mais recente para o mais antigo.
function historicoLogins(n) {
  n = Number(n) || 30;
  let linhas = [];
  try { linhas = fs.readFileSync(F_LOG, 'utf8').split('\n').filter(Boolean); } catch (_) { return []; }
  const out = [];
  for (let i = linhas.length - 1; i >= 0 && out.length < n; i--) {
    try { const o = JSON.parse(linhas[i]); if (o && o.usuario) out.push(o); } catch (_) {}
  }
  return out;
}

module.exports = { registrarAcesso, ultimoAcesso, ultimosAcessos, registrarLogin, historicoLogins };
