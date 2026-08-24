/**
 * instagram-config.js — liga/desliga o job do Instagram SEM reiniciar o robô.
 *
 * O painel grava data/instagram-config.json {enabled}. O scheduler consulta
 * ligado() no momento do disparo (07:00). Sem o arquivo, cai para a variável de
 * ambiente IG_ENABLED (comportamento antigo) — então o padrão continua o mesmo.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'instagram-config.json');

function ler() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function ligado() {
  const o = ler();
  if (typeof o.enabled === 'boolean') return o.enabled;   // painel decide
  return process.env.IG_ENABLED === 'true';                // senão, o .env
}
function fonte() { return typeof ler().enabled === 'boolean' ? 'painel' : 'env'; }
function definir(enabled) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify({ enabled: !!enabled, atualizadoEm: new Date().toISOString() }, null, 2), 'utf8');
  return !!enabled;
}

module.exports = { ligado, definir, ler, fonte, ARQUIVO };
