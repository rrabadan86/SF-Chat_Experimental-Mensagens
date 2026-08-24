/**
 * teste-envio.js — PONTE entre o painel e o robô para "enviar teste".
 *
 * O painel (processo separado) NÃO tem a sessão do WhatsApp — quem envia é o
 * robô (slimfit-exp). Então o painel grava um pedido em data/teste-envio.json e
 * o robô, que fica de olho nesse arquivo (ver scheduler: iniciarTesteWatcher),
 * envia e escreve o resultado de volta. O painel consulta pelo id.
 *
 * Guardamos só os últimos pedidos (o arquivo não cresce).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'teste-envio.json');
const MAX = 20;

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return Array.isArray(o) ? o : []; }
  catch (_) { return []; }
}
function salvar(arr) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(arr.slice(-MAX), null, 2), 'utf8');
}

// Painel: cria um pedido de teste. Retorna o id para consulta.
function solicitar({ telefone, texto }) {
  const tel = String(telefone || '').replace(/\D/g, '');
  if (tel.length < 10) throw new Error('Número inválido (informe DDD + número).');
  if (!String(texto || '').trim()) throw new Error('Mensagem vazia.');
  const arr = carregar();
  const id = crypto.randomBytes(6).toString('hex');
  arr.push({ id, telefone: tel, texto: String(texto), status: 'pendente', erro: '', criadoEm: new Date().toISOString() });
  salvar(arr);
  return id;
}

function ler(id) { return carregar().find(p => p.id === id) || null; }

// Robô: pega o pedido pendente mais antigo (ou null).
function proximoPendente() { return carregar().find(p => p.status === 'pendente') || null; }

// Marca o resultado de um pedido.
function marcar(id, status, erro) {
  const arr = carregar();
  const p = arr.find(x => x.id === id);
  if (!p) return;
  p.status = status;
  p.erro = erro || '';
  p.processadoEm = new Date().toISOString();
  salvar(arr);
}

module.exports = { solicitar, ler, proximoPendente, marcar, carregar, ARQUIVO };
