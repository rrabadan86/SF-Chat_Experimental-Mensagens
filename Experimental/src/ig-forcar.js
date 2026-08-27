/**
 * ig-forcar.js — PONTE painel↔robô para FORÇAR o envio de boas-vindas do
 * Instagram AGORA (sem esperar as 07:00). O painel grava o pedido; o robô
 * (scheduler), que tem navegador+proxy+cookies, executa e escreve o resultado.
 * Um só pedido por vez.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'ig-forcar.json');

function ler() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvar(o) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = ARQUIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf8');
  fs.renameSync(tmp, ARQUIVO);
}

// Painel pede o disparo. Não empilha: se já há um em andamento/pendente, devolve ele.
function pedir() {
  const o = ler();
  if (o.status === 'pendente' || o.status === 'executando') return o;
  salvar({ status: 'pendente', pedidoEm: new Date().toISOString() });
  return ler();
}
function estado() { return ler(); }
// Robô: atualiza a fase/resultado (executando → concluido/falha).
function marcar(status, extra) {
  salvar(Object.assign(ler(), { status, atualizadoEm: new Date().toISOString() }, extra || {}));
}

module.exports = { pedir, estado, marcar, ler, ARQUIVO };
