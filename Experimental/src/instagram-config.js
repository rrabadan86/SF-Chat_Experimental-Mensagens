/**
 * instagram-config.js — ajustes do job do Instagram editáveis no painel, SEM
 * reiniciar o robô: liga/desliga e o limite de envios por dia.
 *
 * Grava em data/instagram-config.json. O scheduler consulta ligado() no disparo
 * (07:00) e o instagram-boasvindas consulta maxDia() a cada execução. Sem o
 * arquivo (ou sem o campo), cai para as variáveis de ambiente IG_ENABLED /
 * IG_MAX_DIA — então o padrão continua o mesmo.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'instagram-config.json');

function ler() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
// Grava mesclando (preserva os outros campos) + carimbo.
function gravar(patch) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const novo = Object.assign({}, ler(), patch, { atualizadoEm: new Date().toISOString() });
  fs.writeFileSync(ARQUIVO, JSON.stringify(novo, null, 2), 'utf8');
  return novo;
}

function ligado() {
  const o = ler();
  if (typeof o.enabled === 'boolean') return o.enabled;   // painel decide
  return process.env.IG_ENABLED === 'true';                // senão, o .env
}
function fonte() { return typeof ler().enabled === 'boolean' ? 'painel' : 'env'; }
function definir(enabled) { gravar({ enabled: !!enabled }); return !!enabled; }

// Limite de envios por dia (1..100). Override do painel ou IG_MAX_DIA do .env.
function maxDia() {
  const n = parseInt(ler().maxDia, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  const env = parseInt(process.env.IG_MAX_DIA || '20', 10);
  return (Number.isFinite(env) && env >= 1) ? env : 20;
}
function fonteMax() { const n = parseInt(ler().maxDia, 10); return (Number.isFinite(n) && n >= 1 && n <= 100) ? 'painel' : 'env'; }
function definirMax(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 1 || v > 100) throw new Error('Limite inválido (use um número de 1 a 100).');
  gravar({ maxDia: v });
  return v;
}

module.exports = { ligado, definir, fonte, maxDia, definirMax, fonteMax, ler, ARQUIVO };
