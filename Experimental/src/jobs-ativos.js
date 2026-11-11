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

// Envios que começam DESLIGADOS (mexem em algo que não tem volta, como tirar
// alguém de grupo): só rodam depois de ligados no painel em cada unidade.
const DESLIGADOS_PADRAO = new Set(['saidaGrupos', 'venceHoje', 'sentimosFalta', 'assinaturas', 'semResposta1', 'semResposta2', 'semRespostaEquipe1', 'semRespostaEquipe2', 'encerramentoManha', 'encerramentoTarde', 'noShowEncerraManha', 'noShowEncerraTarde', 'retomadaEncerra', 'retomadaSofia', 'boasVindas', 'indicacao30']);

// LIGADO por padrão: só está desligado se gravado explicitamente como false
// (os de DESLIGADOS_PADRAO, ao contrário, só ligam se gravados como true).
function ativo(chave) {
  const m = carregar();
  const k = String(chave);
  if (DESLIGADOS_PADRAO.has(k)) return m[k] === true;
  return m[k] !== false;
}

// Liga/desliga uma chave. on=true remove a entrada (volta ao padrão ligado).
function setAtivo(chave, on) {
  const m = carregar();
  const k = String(chave);
  if (DESLIGADOS_PADRAO.has(k)) { if (on) m[k] = true; else delete m[k]; }
  else if (on) delete m[k]; else m[k] = false;
  salvarMapa(m);
  return ativo(chave);
}

module.exports = { ativo, setAtivo, carregar, ARQUIVO };
