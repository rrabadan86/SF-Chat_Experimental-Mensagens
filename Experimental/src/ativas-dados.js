/**
 * ativas-dados.js — leitura do histórico de ALUNAS ATIVAS (data/alunas-ativas-historico.json,
 * gravado pelo agendamento_evo/run_ativas_foto.py). Usado pela tela Indicadores →
 * Alunas ativas e pelo resumo mensal no WhatsApp (resumo-mensal.js), para os dois
 * mostrarem os mesmos números.
 */
const fs = require('fs');
const path = require('path');

const ARQ = path.resolve(__dirname, '..', 'data', 'alunas-ativas-historico.json');
const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function ler() { try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')) || {}; } catch (_) { return {}; } }

// Série diária → [{ dia:'YYYY-MM-DD', a, e, n, s }]
function serie(rec) {
  if (!rec || !Array.isArray(rec.ativas) || !rec.inicio) return [];
  const d0 = new Date(rec.inicio + 'T12:00:00Z');
  return rec.ativas.map((a, i) => {
    const d = new Date(d0.getTime() + i * 86400000);
    return { dia: d.toISOString().slice(0, 10), a, e: (rec.entraram || [])[i] || 0, n: (rec.novas || [])[i] || 0, s: (rec.sairam || [])[i] || 0 };
  });
}
// Agrupa a série por mês ('mes') ou semana começando na segunda ('semana').
function periodos(ser, vis) {
  const chave = (dia) => {
    if (vis === 'mes') return dia.slice(0, 7);
    const d = new Date(dia + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
    return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  };
  const out = [];
  let cur = null, ant = null;
  for (const p of ser) {
    const k = chave(p.dia);
    if (!cur || cur.k !== k) {
      if (cur) out.push(cur);
      cur = { k, ini: ant ? ant.a : p.a - p.e + p.s, fim: p.a, e: 0, n: 0, s: 0, de: p.dia, ate: p.dia };
    }
    cur.fim = p.a; cur.e += p.e; cur.n += p.n; cur.s += p.s; cur.ate = p.dia;
    ant = p;
  }
  if (cur) out.push(cur);
  return out;
}
// Um mês só até o dia `ate` (1..31), com os mesmos campos de periodos(). Serve para
// comparar o mês que ainda não fechou com outro mês nos MESMOS dias (1 a 20 × 1 a 20)
// — mês parcial contra mês cheio faz o atual parecer sempre melhor em saídas.
function mesAteDia(ser, k, ate) {
  let cur = null, ant = null;
  for (const p of ser) {
    const m = p.dia.slice(0, 7);
    if (m === k && +p.dia.slice(8) <= ate) {
      if (!cur) cur = { k, ini: ant ? ant.a : p.a - p.e + p.s, fim: p.a, e: 0, n: 0, s: 0, de: p.dia, ate: p.dia };
      cur.fim = p.a; cur.e += p.e; cur.n += p.n; cur.s += p.s; cur.ate = p.dia;
    }
    if (m < k) ant = p;
  }
  return cur;
}
// Quem saiu há poucos dias e AINDA PODE RENOVAR sem contar como saída: o contrato
// venceu dentro da tolerância (padrão 7 dias). Se ela renovar nesse prazo, o
// histórico junta os dois contratos e a saída some — por isso o mês em andamento
// sempre parece pior do que vai fechar. → [{ id, nome, fim, saiu, fila }]
// (saiu = dia em que a saída foi contada; fila = [contrato, início] se já renovou).
function emRenovacao(pessoas, hojeIso, tolerancia) {
  if (!pessoas || !hojeIso) return [];
  const tol = Number.isFinite(tolerancia) ? tolerancia : 7;
  const soma = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
  const limite = soma(hojeIso, -(tol + 1));
  const out = [];
  for (const id in pessoas) {
    const p = pessoas[id], iv = p && p.iv;
    if (!Array.isArray(iv) || !iv.length) continue;
    const fim = iv[iv.length - 1][1];
    if (!fim || fim >= hojeIso || fim < limite) continue;
    out.push({ id, nome: p.n || '', fim, saiu: soma(fim, 1), fila: Array.isArray(p.fq) ? p.fq : null });
  }
  return out;
}
// ── Retenção ────────────────────────────────────────────────────────────────
const _somaDias = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const _somaMeses = (d, n) => { const x = new Date(d + 'T12:00:00Z'); const dia = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); const ult = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(dia, ult)); return x.toISOString().slice(0, 10); };
const _fimDoMes = (k) => { const [y, m] = k.split('-').map(Number); return `${k}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const _mediana = (v) => { if (!v.length) return null; const o = v.slice().sort((a, b) => a - b), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
const _ativaEm = (iv, dia) => iv.some(([a, b]) => a <= dia && b >= dia);

// Permanência por SAFRA: de quem começou (primeiro contrato) em cada mês, quantas
// continuavam ativas 3, 6 e 12 meses depois. Uma casa só é preenchida quando a
// safra INTEIRA já teve aquele tempo (senão o número ainda vai cair) — fica null.
// Quem saiu e voltou conta como ativa no dia medido.
// → [{ k:'AAAA-MM', n, r3, r6, r12 }] do mais recente para o mais antigo.
function safras(pessoas, hojeIso, quantos) {
  if (!pessoas || !hojeIso) return [];
  const por = {};
  for (const id in pessoas) {
    const iv = pessoas[id] && pessoas[id].iv;
    if (!Array.isArray(iv) || !iv.length || !iv[0][0] || iv[0][0] > hojeIso) continue;
    (por[iv[0][0].slice(0, 7)] = por[iv[0][0].slice(0, 7)] || []).push(iv);
  }
  const mesHoje = hojeIso.slice(0, 7);
  return Object.keys(por).filter(k => k < mesHoje).sort().reverse().slice(0, quantos || 15).map(k => {
    const grupo = por[k], o = { k, n: grupo.length };
    for (const m of [3, 6, 12]) {
      // a última a entrar na safra (fim do mês) já completou m meses?
      o['r' + m] = _somaMeses(_fimDoMes(k), m) <= hojeIso ? grupo.filter(iv => _ativaEm(iv, _somaMeses(iv[0][0], m))).length : null;
    }
    return o;
  });
}
// Por que saíram, mês a mês: NÃO RENOVOU (o contrato chegou ao fim) × RESCINDIU
// (cancelou antes do fim). A saída conta no dia seguinte ao fim, como na série.
// Só entram saídas já fora da tolerância de renovação — as outras ainda podem sumir.
// → { 'AAAA-MM': { naoRenovou, rescindiu } }
function motivosSaida(pessoas, hojeIso, tolerancia) {
  const out = {};
  if (!pessoas || !hojeIso) return out;
  const tol = Number.isFinite(tolerancia) ? tolerancia : 7;
  const limite = _somaDias(hojeIso, -(tol + 1));
  for (const id in pessoas) {
    const p = pessoas[id], iv = p && p.iv, cs = (p && p.cs) || [];
    if (!Array.isArray(iv)) continue;
    for (const [a, b] of iv) {
      if (!b || b >= limite) continue; // ainda ativa, ou saída que ainda pode ser desfeita
      // o contrato que terminou esse período: o de fim mais tarde dentro dele
      let ult = null;
      for (const c of cs) if (c && c[0] >= a && c[1] <= b && (!ult || c[1] > ult[1])) ult = c;
      const k = _somaDias(b, 1).slice(0, 7);
      const m = out[k] || (out[k] = { naoRenovou: 0, rescindiu: 0 });
      if (ult && ult[4]) m.rescindiu++; else m.naoRenovou++;
    }
  }
  return out;
}
// Tempo de permanência (meses, mediana) de quem SAIU nos últimos `meses` meses —
// do começo ao fim do último período contínuo como aluna — e das ativas de hoje.
function permanencia(pessoas, hojeIso, meses, tolerancia) {
  const r = { saidas: 0, medianaSaidas: null, ativas: 0, medianaAtivas: null };
  if (!pessoas || !hojeIso) return r;
  const tol = Number.isFinite(tolerancia) ? tolerancia : 7;
  const limite = _somaDias(hojeIso, -(tol + 1)), desde = _somaMeses(hojeIso, -(meses || 12));
  const emMeses = (a, b) => (new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000 / 30.44;
  const sai = [], atv = [];
  for (const id in pessoas) {
    const iv = pessoas[id] && pessoas[id].iv;
    if (!Array.isArray(iv) || !iv.length) continue;
    const [a, b] = iv[iv.length - 1];
    if (!a || !b || a > hojeIso) continue;
    if (b >= hojeIso) atv.push(emMeses(a, hojeIso));
    else if (b < limite && b >= desde) sai.push(emMeses(a, b));
  }
  const arred = (v) => v == null ? null : Math.round(v * 10) / 10;
  r.saidas = sai.length; r.medianaSaidas = arred(_mediana(sai));
  r.ativas = atv.length; r.medianaAtivas = arred(_mediana(atv));
  return r;
}
function rotuloPeriodo(p, vis, longo) {
  if (vis === 'mes') { const [y, m] = p.k.split('-'); return longo ? `${MESES_LONGO[+m - 1]}/${y}` : `${MESES_CURTO[+m - 1]}/${y.slice(2)}`; }
  const [, m, d] = p.k.split('-'); return `${d}/${m}`;
}

// Contratos que não são do método (padrão: CIRCUITO e VIP — mesma regra do
// run_ativas_foto.py, ATIVAS_IGNORAR_CONTRATOS no .env): não contam como aluna
// ativa nem como "fechou contrato" depois da experimental.
function contratoIgnorado(nome) {
  const n = String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!n) return false;
  return String(process.env.ATIVAS_IGNORAR_CONTRATOS || 'circuito,vip').split(',').map(x => x.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')).filter(Boolean)
    .some(t => new RegExp('(^|[^a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n));
}

module.exports = { contratoIgnorado, ARQ, MESES_CURTO, MESES_LONGO, ler, serie, periodos, rotuloPeriodo, mesAteDia, emRenovacao, safras, motivosSaida, permanencia };
