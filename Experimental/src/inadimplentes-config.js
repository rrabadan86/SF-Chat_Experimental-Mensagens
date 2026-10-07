/**
 * Config da cobrança de inadimplentes editável no painel.
 * Hoje: "dias" = vencido há X+ dias (padrão 2). Guardado em
 * data/inadimplentes-config.json. Prioridade: painel > .env (INADIMPLENTES_DIAS)
 * > padrão 2.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data', 'inadimplentes-config.json');
const MIN = 0, MAX = 60, PADRAO = 2;

function valido(n) { return Number.isFinite(n) && n >= MIN && n <= MAX; }

function lerDias() {
  try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); const n = Number(o && o.dias); if (valido(n)) return n; } catch (_) {}
  if (process.env.INADIMPLENTES_DIAS) { const n = parseInt(process.env.INADIMPLENTES_DIAS, 10); if (valido(n)) return n; }
  return PADRAO;
}

function salvarDias(n) {
  const v = parseInt(n, 10);
  if (!valido(v)) throw new Error(`Informe um número de dias entre ${MIN} e ${MAX}.`);
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); } catch (_) {}
  fs.writeFileSync(FILE, JSON.stringify({ dias: v }, null, 2), 'utf8');
  return v;
}

module.exports = { lerDias, salvarDias, FILE, PADRAO, MIN, MAX };
