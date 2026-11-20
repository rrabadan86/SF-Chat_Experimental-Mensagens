/**
 * metas.js — metas do mês, ritmo e fechamento mensal (Indicadores → Metas).
 *
 * Três arquivos em data/ (nenhum vai para o git):
 *   metas.json              { meses: { 'AAAA-MM': { ativas, entradas, agendamentos, recebido, ocupacao } } }
 *                           A meta de um mês vale para os seguintes até alguém mudar.
 *   indicadores-meses.json  { 'AAAA-MM': { fin: {...}, grade: {...} } } — a posição mais recente
 *                           LIDA DO EVO dentro de cada mês (recebimentos e ocupação só existem
 *                           "agora"; sem guardar, o mês passado não teria esses números).
 *   fechamentos.json        { 'AAAA-MM': { fechadoEm, ativas, funil, fin, grade, metas } } — a FOTO
 *                           do mês fechado. Depois de gravada não muda mais: os números "ao vivo"
 *                           de um mês antigo continuam mexendo (tags, renovações atrasadas), a
 *                           foto não.
 *
 * Só contas e arquivos — sem HTML (a tela fica em painel-metas.js).
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const ARQ_METAS = path.join(DATA, 'metas.json');
const ARQ_POS = path.join(DATA, 'indicadores-meses.json');
const ARQ_FECH = path.join(DATA, 'fechamentos.json');

// tipo 'soma'  = vai acumulando no mês (o esperado até hoje é uma fração da meta);
// tipo 'nivel' = é uma posição (alunas ativas, ocupação): vale o número do dia.
const CAMPOS = [
  { k: 'ativas', rot: 'Alunas ativas no fim do mês', curto: 'Alunas ativas', tipo: 'nivel' },
  { k: 'entradas', rot: 'Entradas no mês (novas + retornos)', curto: 'Entradas', tipo: 'soma' },
  { k: 'agendamentos', rot: 'Aulas experimentais agendadas', curto: 'Experimentais agendadas', tipo: 'soma' },
  { k: 'recebido', rot: 'Recebido no mês (R$)', curto: 'Recebido', tipo: 'soma', moeda: true },
  { k: 'ocupacao', rot: 'Ocupação das turmas (%)', curto: 'Ocupação das turmas', tipo: 'nivel', pct: true },
];

const lerJson = (arq, padrao) => { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o && typeof o === 'object' ? o : padrao; } catch (_) { return padrao; } };
const gravarJson = (arq, obj) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); const tmp = arq + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, arq); };
const ehMes = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const mesSeguinte = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const mesAnterior = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
const diasNoMes = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };

// ── Metas ───────────────────────────────────────────────────────────────────
function lerMetas() { const o = lerJson(ARQ_METAS, {}); return { meses: (o.meses && typeof o.meses === 'object') ? o.meses : {} }; }
// Metas que valem para um mês: as dele; se não tiver, as do mês mais recente antes dele.
// → { valores: {campo: número}, de: 'AAAA-MM' | '', herdada: bool }
function metasDoMes(mes) {
  const { meses } = lerMetas();
  if (meses[mes]) return { valores: { ...meses[mes] }, de: mes, herdada: false };
  const antes = Object.keys(meses).filter(k => ehMes(k) && k < mes).sort();
  if (!antes.length) return { valores: {}, de: '', herdada: false };
  const de = antes[antes.length - 1];
  return { valores: { ...meses[de] }, de, herdada: true };
}
// Aceita "1.234,50", "1234.5", "" (sem meta). Erro em valor negativo ou não numérico.
function numero(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return null;
  const n = Number(/,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
  if (!isFinite(n) || n < 0) throw new Error(`"${t}" não é um número válido`);
  return n;
}
function salvarMetas(mes, entrada) {
  if (!ehMes(mes)) throw new Error('mês inválido');
  const valores = {};
  for (const c of CAMPOS) {
    const n = numero(entrada && entrada[c.k]);
    if (n == null) continue;
    if (c.pct && n > 100) throw new Error(`${c.curto}: o máximo é 100%`);
    valores[c.k] = c.moeda ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10;
  }
  const o = lerMetas();
  o.meses[mes] = valores;
  gravarJson(ARQ_METAS, o);
  return valores;
}

// ── Ritmo ───────────────────────────────────────────────────────────────────
// Diz se o mês está no caminho da meta.
//   soma : esperado até hoje = meta × fração do mês; projeção = realizado ÷ fração.
//   nivel: com `ini` (valor no começo do mês) o esperado anda de ini até a meta;
//          sem `ini` (ex.: ocupação) compara direto com a meta.
// `fracao` = quanto do mês já passou (0..1). Para "recebido", quem chama passa a
// fração do PREVISTO que já venceu (vencimento não é espalhado igual pelo mês).
// → { status: 'sem' | 'batida' | 'ritmo' | 'abaixo', esperado, projecao, pct }
function ritmo({ tipo, meta, real, fracao, ini }) {
  if (meta == null || !isFinite(meta) || meta <= 0 || real == null || !isFinite(real)) return { status: 'sem', esperado: null, projecao: null, pct: null };
  const f = Math.max(0, Math.min(1, Number(fracao) || 0));
  const pct = Math.round(real * 1000 / meta) / 10;
  let esperado, projecao;
  if (tipo === 'soma') {
    esperado = meta * f;
    projecao = f > 0 ? real / f : null;
  } else if (ini != null && isFinite(ini)) {
    // começou o mês já acima da meta: o esperado é só não cair abaixo dela
    esperado = ini >= meta ? meta : ini + (meta - ini) * f;
    projecao = f > 0 ? ini + (real - ini) / f : null;
  } else {
    esperado = meta; projecao = real;
  }
  // 5% de folga: um dia fraco não vira "abaixo do ritmo".
  const folga = tipo === 'soma' || ini == null ? Math.abs(esperado) * 0.05 : Math.max(0.5, Math.abs(meta - ini) * 0.05);
  const status = real >= meta ? 'batida' : (real >= esperado - folga ? 'ritmo' : 'abaixo');
  return { status, esperado, projecao, pct };
}

// ── Posição mais recente de cada mês (recebimentos e grade) ─────────────────
function posicoes() { return lerJson(ARQ_POS, {}); }
// Guarda a leitura `bloco` ('fin' | 'grade') do mês; só troca por uma leitura mais nova.
function registrarPosicao(mes, bloco, dados, lidoEm) {
  if (!ehMes(mes) || !dados || !['fin', 'grade'].includes(bloco)) return false;
  const o = posicoes();
  const atual = (o[mes] || {})[bloco];
  const em = String(lidoEm || '');
  if (atual && String(atual.lidoEm || '') > em) return false;
  if (atual && JSON.stringify({ ...atual, lidoEm: em }) === JSON.stringify({ ...dados, lidoEm: em }) && atual.lidoEm === em) return false;
  o[mes] = { ...(o[mes] || {}), [bloco]: { ...dados, lidoEm: em } };
  gravarJson(ARQ_POS, o);
  return true;
}

// ── Fechamento ──────────────────────────────────────────────────────────────
function fechamentos() { return lerJson(ARQ_FECH, {}); }
// Um mês só fecha quando a tolerância de renovação dele já passou: quem venceu no
// fim do mês ainda pode renovar por `tolerancia` dias sem contar como saída. Com
// 7 dias, o mês fecha no dia 9 do mês seguinte. `hojeIso` = último dia do histórico
// de alunas ativas (se o histórico está parado, não fecha).
function diaDeFechar(mes, tolerancia) {
  const tol = Number.isFinite(tolerancia) ? tolerancia : 7;
  return `${mesSeguinte(mes)}-${String(Math.min(28, tol + 2)).padStart(2, '0')}`;
}
function podeFechar(mes, hojeIso, tolerancia) { return ehMes(mes) && !!hojeIso && hojeIso >= diaDeFechar(mes, tolerancia); }
// Grava a foto do mês. Nunca sobrescreve um mês já fechado.
function fechar(mes, dados, agora) {
  if (!ehMes(mes)) throw new Error('mês inválido');
  const o = fechamentos();
  if (o[mes]) return false;
  o[mes] = { ...dados, fechadoEm: agora || new Date().toISOString() };
  gravarJson(ARQ_FECH, o);
  return true;
}

module.exports = {
  ARQ_METAS, ARQ_POS, ARQ_FECH, CAMPOS, ehMes, mesSeguinte, mesAnterior, diasNoMes,
  lerMetas, metasDoMes, salvarMetas, numero, ritmo, posicoes, registrarPosicao, fechamentos, diaDeFechar, podeFechar, fechar,
};
