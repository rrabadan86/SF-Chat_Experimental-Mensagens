/**
 * grupos.js — nomes dos grupos do WhatsApp, EDITÁVEIS PELO PAINEL.
 *
 * Antes o nome do grupo ficava só no .env (GRUPO_EQUIPE / CIRCUITO_GRUPO) com um
 * padrão fixo no código. Agora o painel grava em data/grupos.json e os jobs leem
 * daqui. Ordem de prioridade: painel (data/grupos.json) > .env > padrão.
 *
 * Os jobs de grupo (aniversário, ausentes, resumo, circuito) rodam como processos
 * separados a cada disparo, então leem o valor atual no início de cada execução.
 */
const fs = require('fs');
const path = require('path');

const ARQ = path.resolve(__dirname, '..', 'data', 'grupos.json');

function ler() {
  try { const o = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function _val(chave, envVar, padrao) {
  const v = String((ler()[chave] || '')).trim();
  if (v) return v;
  const e = String(process.env[envVar] || '').trim();
  if (e) return e;
  return padrao;
}
// Grupo da EQUIPE (professoras): aniversários, ausentes, resumo do dia.
function equipe() { return _val('equipe', 'GRUPO_EQUIPE', 'SlimFit Equipe 💪'); }
// Grupo do CIRCUITO (convocação/lembrete das alunas).
function circuito() { return _val('circuito', 'CIRCUITO_GRUPO', 'Circuito Slim'); }

function salvar({ equipe, circuito } = {}) {
  const o = ler();
  if (equipe !== undefined) o.equipe = String(equipe || '').trim();
  if (circuito !== undefined) o.circuito = String(circuito || '').trim();
  try { if (!fs.existsSync(path.dirname(ARQ))) fs.mkdirSync(path.dirname(ARQ), { recursive: true }); } catch (_) {}
  const tmp = ARQ + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf8');
  fs.renameSync(tmp, ARQ);
  return o;
}

module.exports = { equipe, circuito, ler, salvar, ARQ };
