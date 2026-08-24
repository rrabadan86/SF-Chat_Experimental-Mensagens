/**
 * teste-instagram.js — PONTE painel↔robô para enviar um DM de TESTE no Instagram.
 *
 * O painel não tem navegador/proxy/cookies do IG; quem envia é o robô. O painel
 * grava o pedido aqui (data/teste-instagram.json) e o robô, que tem tudo,
 * dispara o DM e escreve o resultado. Enviar com sucesso também comprova que o
 * cookie está válido.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'teste-instagram.json');
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

function solicitar({ username, texto }) {
  const u = String(username || '').replace(/^@+/, '').trim().split(/\s+/)[0];
  if (!u) throw new Error('Informe o @usuário do Instagram.');
  const arr = carregar();
  const id = crypto.randomBytes(6).toString('hex');
  arr.push({ id, username: u, texto: String(texto || ''), status: 'pendente', erro: '', criadoEm: new Date().toISOString() });
  salvar(arr);
  return id;
}

function ler(id) { return carregar().find(p => p.id === id) || null; }
function proximoPendente() { return carregar().find(p => p.status === 'pendente') || null; }
function marcar(id, status, erro) {
  const arr = carregar();
  const p = arr.find(x => x.id === id);
  if (!p) return;
  p.status = status; p.erro = erro || ''; p.processadoEm = new Date().toISOString();
  salvar(arr);
}

module.exports = { solicitar, ler, proximoPendente, marcar, carregar, ARQUIVO };
