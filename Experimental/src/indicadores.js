/**
 * indicadores.js — MÉTRICAS do formulário (acessos, agendamentos, conversão).
 *
 * O formulário (Render) registra cada acesso e cada agendamento; o VPS puxa
 * esses eventos (ver pull-indicadores.js) e grava aqui em data/indicadores.json.
 * O painel (aba Indicadores) lê e mostra os números. O dia/hora é carimbado NO
 * VPS na hora de gravar (fuso de São Paulo) — não depende do relógio da Render.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'indicadores.json');
const MAX = 200000; // cap de segurança (rotaciona os mais antigos)

function hojeSP() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function horaSP() { return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); }

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return Array.isArray(o) ? o : []; }
  catch (_) { return []; }
}
function salvar(arr) {
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(arr.slice(-MAX)), 'utf8');
}

// Grava eventos novos (dedupe por id). Carimba dia/hora em SP na hora de gravar.
// Retorna quantos foram realmente adicionados.
function registrar(eventos) {
  if (!Array.isArray(eventos) || eventos.length === 0) return 0;
  const arr = carregar();
  const vistos = new Set(arr.map(e => e.id));
  let add = 0;
  for (const ev of eventos) {
    if (!ev || !ev.id || vistos.has(ev.id)) continue;
    vistos.add(ev.id);
    arr.push({
      id: ev.id,
      tipo: ev.tipo === 'agendou' ? 'agendou' : 'acesso',
      origem: (ev.origem || '').toString().slice(0, 40),
      dia: hojeSP(),
      quando: horaSP(),
      tsForm: ev.ts || '',
    });
    add++;
  }
  if (add) salvar(arr);
  return add;
}

// dias: janela (0 = tudo). Retorna resumo pronto para o painel.
function resumo(dias) {
  const arr = carregar();
  const janela = parseInt(dias, 10) || 0;
  let corte = null;
  if (janela > 0) {
    const d = new Date(); d.setDate(d.getDate() - (janela - 1));
    corte = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }
  const evs = corte ? arr.filter(e => e.dia >= corte) : arr;

  const acessos = evs.filter(e => e.tipo === 'acesso').length;
  const agendamentos = evs.filter(e => e.tipo === 'agendou').length;
  const conversao = acessos > 0 ? (agendamentos / acessos) * 100 : 0;

  // Por dia (últimos min(janela,30) dias, do mais recente ao mais antigo).
  const nDias = Math.min(janela > 0 ? janela : 30, 30);
  const porDia = [];
  for (let i = 0; i < nDias; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const doDia = arr.filter(e => e.dia === dia);
    porDia.push({
      dia,
      acessos: doDia.filter(e => e.tipo === 'acesso').length,
      agendamentos: doDia.filter(e => e.tipo === 'agendou').length,
    });
  }

  // Por origem (só aparece se houver origem etiquetada).
  const porOrigemMap = {};
  for (const e of evs) {
    const o = e.origem || '(sem etiqueta)';
    if (!porOrigemMap[o]) porOrigemMap[o] = { origem: o, acessos: 0, agendamentos: 0 };
    if (e.tipo === 'acesso') porOrigemMap[o].acessos++; else porOrigemMap[o].agendamentos++;
  }
  const porOrigem = Object.values(porOrigemMap).sort((a, b) => (b.acessos + b.agendamentos) - (a.acessos + a.agendamentos));
  const temOrigem = evs.some(e => e.origem);

  return {
    acessos, agendamentos,
    conversao: Math.round(conversao * 10) / 10,
    naoAgendaram: Math.max(0, acessos - agendamentos),
    porDia,
    porOrigem, temOrigem,
    primeiroDia: arr.length ? arr[0].dia : null,
    total: arr.length,
  };
}

module.exports = { registrar, resumo, carregar, hojeSP, ARQUIVO };
