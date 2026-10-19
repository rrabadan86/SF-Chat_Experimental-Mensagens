/**
 * Config da RENOVAÇÃO de contrato editável no painel.
 *
 * Guarda em data/renovacao-config.json a antecedência (dias antes do vencimento)
 * do aviso. Tem prioridade sobre o .env (RENOVACAO_DIAS_ANTES); sem nenhum dos
 * dois, o padrão é 7 dias. Lido a cada disparo do job (14:30) — vale sem reiniciar.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'renovacao-config.json');
const PADRAO = 7, MIN = 1, MAX = 90;

function ler() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) || {}; }
  catch (_) { return {}; }
}

function salvar(cfg) {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(cfg || {}, null, 2));
    return true;
  } catch (_) { return false; }
}

// Antecedência efetiva (dias): painel > .env (RENOVACAO_DIAS_ANTES) > padrão (7).
function diasAntes() {
  const n = parseInt(ler().diasAntes, 10);
  if (Number.isFinite(n) && n >= MIN && n <= MAX) return n;
  const env = parseInt(process.env.RENOVACAO_DIAS_ANTES || '', 10);
  if (Number.isFinite(env) && env >= MIN && env <= MAX) return env;
  return PADRAO;
}

// Grava só a antecedência, validando o intervalo. Retorna o valor aplicado ou null.
function salvarDias(valor) {
  const n = parseInt(valor, 10);
  if (!Number.isFinite(n) || n < MIN || n > MAX) return null;
  const cfg = ler();
  cfg.diasAntes = n;
  return salvar(cfg) ? n : null;
}

module.exports = { ler, salvar, diasAntes, salvarDias, ARQUIVO, PADRAO, MIN, MAX };
