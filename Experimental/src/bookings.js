/**
 * bookings.js — LOG COMPLETO dos agendamentos feitos pelo formulário/SoFIA.
 *
 * O formulário (Render) grava cada agendamento com os dados completos que a
 * pessoa digitou (nome, CPF, telefone, e-mail, nascimento) + o horário e o que o
 * EVO fez com o cadastro (criou/reaproveitou/atualizou). O VPS puxa esses
 * registros (ver pull-bookings.js) e os persiste aqui em data/bookings.json. O
 * painel (aba Formulário) lê e mostra a tabela. Serve para conferir os dados
 * completos quando o cadastro do EVO veio incompleto (ex.: cadastro antigo).
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'bookings.json');
const MAX = 50000; // cap de segurança (rotaciona os mais antigos)

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return Array.isArray(o) ? o : []; }
  catch (_) { return []; }
}
function salvar(arr) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(arr.slice(-MAX)), 'utf8');
}

// Grava registros novos (dedupe por id). Retorna quantos foram adicionados.
function registrar(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const arr = carregar();
  const vistos = new Set(arr.map(r => r.id));
  let add = 0;
  for (const r of rows) {
    if (!r || !r.id || vistos.has(r.id)) continue;
    vistos.add(r.id);
    const s = (v, n) => (v == null ? '' : String(v)).slice(0, n);
    arr.push({
      id: r.id,
      ts: s(r.ts, 30),
      nome: s(r.nome, 120),
      cpf: s(r.cpf, 20),
      telefone: s(r.telefone, 20),
      email: s(r.email, 120),
      nascimento: s(r.nascimento, 20),
      when: s(r.when, 40),               // horário da aula (data real resolvida)
      activity: s(r.activity, 60),
      origem: s(r.origem, 40),
      idProspect: r.idProspect || '',
      cadastroNovo: !!r.cadastro_novo,   // true = EVO criou; false = reaproveitou antigo
      atualizacao: r.atualizacao || null, // resultado do update do cadastro antigo
    });
    add++;
  }
  if (add) salvar(arr);
  return add;
}

// Lista para o painel: mais recentes primeiro, com um limite opcional.
function listar(limite) {
  const arr = carregar().slice().reverse();
  const n = parseInt(limite, 10);
  return n > 0 ? arr.slice(0, n) : arr;
}

module.exports = { registrar, listar, carregar, ARQUIVO };
