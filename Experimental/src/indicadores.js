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
      vid: (ev.vid || '').toString().slice(0, 40),  // id do visitante (cookie) — p/ contar pessoas
      hora: (ev.hora || '').toString().slice(0, 5), // horário da aula (só nos agendamentos)
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

  // Pessoas únicas = visitantes distintos (cookie). Acessos sem cookie (legado)
  // contam como 1 cada, para não sumir do total.
  const pessoasDe = (lista) => {
    const s = new Set(); let semVid = 0;
    for (const e of lista) { if (e.tipo !== 'acesso') continue; if (e.vid) s.add(e.vid); else semVid++; }
    return s.size + semVid;
  };

  const acessos = evs.filter(e => e.tipo === 'acesso').length;
  const pessoas = pessoasDe(evs);
  const agendamentos = evs.filter(e => e.tipo === 'agendou').length;
  const conversao = pessoas > 0 ? (agendamentos / pessoas) * 100 : 0;

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
      pessoas: pessoasDe(doDia),
      agendamentos: doDia.filter(e => e.tipo === 'agendou').length,
    });
  }

  // Por origem (só aparece se houver origem etiquetada). Conta acessos,
  // agendamentos e PESSOAS únicas (por cookie vid) de cada canal — assim o funil
  // pode mostrar "de onde vieram" as pessoas e os agendamentos.
  const porOrigemMap = {};
  for (const e of evs) {
    const o = e.origem || '(sem etiqueta)';
    if (!porOrigemMap[o]) porOrigemMap[o] = { origem: o, acessos: 0, agendamentos: 0, _vids: new Set(), _semVid: 0 };
    const rec = porOrigemMap[o];
    if (e.tipo === 'acesso') {
      rec.acessos++;
      if (e.vid) rec._vids.add(e.vid); else rec._semVid++;
    } else {
      rec.agendamentos++;
    }
  }
  const porOrigem = Object.values(porOrigemMap)
    .map(r => ({ origem: r.origem, acessos: r.acessos, agendamentos: r.agendamentos, pessoas: r._vids.size + r._semVid }))
    .sort((a, b) => (b.acessos + b.agendamentos) - (a.acessos + a.agendamentos));
  const temOrigem = evs.some(e => e.origem);

  // Picos de ACESSO por hora do dia e por dia da semana.
  const acessosEvs = evs.filter(e => e.tipo === 'acesso');
  const horaMap = {};
  for (const e of acessosEvs) { const h = String(e.quando || '').slice(0, 2); if (/^\d\d$/.test(h)) horaMap[h] = (horaMap[h] || 0) + 1; }
  const picoHoras = Object.entries(horaMap).map(([h, n]) => ({ hora: h + 'h', n })).sort((a, b) => b.n - a.n);
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const diaSem = [0, 0, 0, 0, 0, 0, 0];
  for (const e of acessosEvs) { const d = new Date(e.dia + 'T12:00:00'); if (!isNaN(d)) diaSem[d.getDay()]++; }
  const picoDias = DIAS.map((nome, i) => ({ dia: nome, n: diaSem[i] }));

  // Mapa de calor: acessos por dia-da-semana (0=Dom..6=Sáb) × hora (0..23).
  // Cruza as duas dimensões num único gráfico (heatmap) — mostra o "quando"
  // real (ex.: terça às 19h), não só o pico de hora e o de dia separados.
  const mapaCalor = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let mapaMax = 0;
  for (const e of acessosEvs) {
    const h = parseInt(String(e.quando || '').slice(0, 2), 10);
    const d = new Date(e.dia + 'T12:00:00');
    if (Number.isInteger(h) && h >= 0 && h < 24 && !isNaN(d)) {
      const wd = d.getDay();
      mapaCalor[wd][h]++;
      if (mapaCalor[wd][h] > mapaMax) mapaMax = mapaCalor[wd][h];
    }
  }

  // Horários de AULA mais escolhidos (entre os agendamentos que carimbaram a hora).
  const aulaMap = {};
  for (const e of evs) { if (e.tipo === 'agendou' && e.hora) aulaMap[e.hora] = (aulaMap[e.hora] || 0) + 1; }
  const horariosAula = Object.entries(aulaMap).map(([hora, n]) => ({ hora, n })).sort((a, b) => (b.n - a.n) || a.hora.localeCompare(b.hora));

  return {
    acessos, pessoas, agendamentos,
    conversao: Math.round(conversao * 10) / 10,
    naoAgendaram: Math.max(0, pessoas - agendamentos),
    porDia,
    porOrigem, temOrigem,
    picoHoras, picoDias, horariosAula,
    mapaCalor, mapaMax,
    primeiroDia: arr.length ? arr[0].dia : null,
    total: arr.length,
  };
}

module.exports = { registrar, resumo, carregar, hojeSP, ARQUIVO };
