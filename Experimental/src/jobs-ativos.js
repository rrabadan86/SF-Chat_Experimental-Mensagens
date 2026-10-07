/**
 * Liga/Desliga de cada ENVIO pelo painel (sem mexer no .env).
 *
 * Guarda em data/jobs-ativos.json um mapa { chaveDoJob: false } apenas para os
 * envios DESLIGADOS. Ausente = LIGADO (padrão). Assim, no primeiro uso, tudo
 * continua ligado (nenhuma mudança de comportamento).
 *
 * A "chave" é a mesma do horário do job (horarios.js / config.schedule), ex.:
 * 'morning', 'aniversarioEx', 'inadimplentes'. O scheduler consulta ativo(chave)
 * antes de disparar; o "Enviar teste" do painel ignora isto (dá pra testar um
 * envio mesmo desligado).
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'jobs-ativos.json');

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvarMapa(m) {
  try { fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true }); } catch (_) {}
  fs.writeFileSync(ARQUIVO, JSON.stringify(m, null, 2), 'utf8');
}

// LIGADO por padrão: só está desligado se gravado explicitamente como false.
function ativo(chave) {
  const m = carregar();
  return m[String(chave)] !== false;
}

// Liga/desliga uma chave. on=true remove a entrada (volta ao padrão ligado).
function setAtivo(chave, on) {
  const m = carregar();
  if (on) delete m[String(chave)]; else m[String(chave)] = false;
  salvarMapa(m);
  return ativo(chave);
}

module.exports = { ativo, setAtivo, carregar, ARQUIVO };
