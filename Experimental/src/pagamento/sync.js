/**
 * pagamento/sync.js — lê do EVO (API de integração) os dados que o cálculo do
 * pagamento dos professores precisa e guarda em data/pagamento/ (na VPS).
 *
 *   mes-AAAA-MM.json  grade de aulas do mês (sessões, professor, horário) e a
 *                     lista de cada aula (quem estava matriculada, presente,
 *                     falta, falta justificada, reposição)
 *   contratos.json    contratos das alunas (plano, valor, vigência, parcelas)
 *   grades.json       grade FIXA de cada aluna (dia/horário da turma, desde/até)
 *
 * Roda de madrugada pelo robô (job "pagamentoSync") e pelo botão "Atualizar
 * dados do EVO" na tela. Devagar de propósito (a chave do EVO é a mesma do
 * formulário de agendamento).
 */
const fs = require('fs');
const path = require('path');
const evo = require('./evo-api');

const DIR = path.resolve(__dirname, '..', '..', 'data', 'pagamento');
const ARQ_CONTRATOS = path.join(DIR, 'contratos.json');
const ARQ_GRADES = path.join(DIR, 'grades.json');
const ARQ_STATUS = path.join(DIR, 'sync-status.json');
const arqMes = (ano, mes) => path.join(DIR, `mes-${ano}-${String(mes).padStart(2, '0')}.json`);

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
function lerJson(arq, padrao) { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o && typeof o === 'object' ? o : padrao; } catch (_) { return padrao; } }
function gravarJson(arq, obj) { fs.mkdirSync(DIR, { recursive: true }); const tmp = arq + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, arq); }
const dia = (s) => String(s || '').slice(0, 10);
const hhmm = (s) => String(s || '').slice(0, 5);

function lerMes(ano, mes) { return lerJson(arqMes(ano, mes), null); }
function lerContratos() { return lerJson(ARQ_CONTRATOS, { porMembro: {} }); }
function lerGrades() { return lerJson(ARQ_GRADES, { porMembro: {} }); }
function lerStatus() { return lerJson(ARQ_STATUS, {}); }
function gravarStatus(o) { try { gravarJson(ARQ_STATUS, Object.assign(lerStatus(), o)); } catch (_) {} }

// ── 1) Grade de aulas do mês (semana a semana, como o EVO devolve) ───────────
async function lerGradeDoMes(ano, mes) {
  const mm = String(mes).padStart(2, '0');
  const ult = new Date(ano, mes, 0).getDate();
  const datas = [];
  for (let d = 1; d <= ult; d += 7) datas.push(`${ano}-${mm}-${String(d).padStart(2, '0')}`);
  if (parseInt(datas[datas.length - 1].slice(8), 10) + 6 < ult) datas.push(`${ano}-${mm}-${ult}`);
  const vistos = new Set(); const out = [];
  for (const date of datas) {
    const sem = await evo.paginado('/api/v1/activities/schedule', { date, showFullWeek: 'true' });
    for (const a of sem) {
      const d = dia(a.activityDate);
      if (d.slice(0, 7) !== `${ano}-${mm}`) continue;
      const k = a.idAtividadeSessao != null ? 's' + a.idAtividadeSessao : `${a.idActivity}_${d}_${a.startTime}`;
      if (vistos.has(k)) continue; vistos.add(k);
      out.push({ s: a.idAtividadeSessao, a: a.idActivity, n: String(a.name || '').trim(), p: String(a.instructor || '').trim(), pi: a.instructorId != null ? String(a.instructorId) : '', d, h: hhmm(a.startTime), cap: a.maxCapacity || 0 });
    }
  }
  return out.sort((x, y) => (x.d + x.h).localeCompare(y.d + y.h));
}

// ── 2) Lista de cada aula (presença) ─────────────────────────────────────────
async function lerListaDaAula(idSessao) {
  const det = await evo.chamar('/api/v1/activities/schedule/detail', { idActivitySession: idSessao });
  return ((det && det.enrollments) || []).filter(e => e && e.idMember).map(e => ({ m: Number(e.idMember), n: String(e.name || '').trim(), r: !!e.replacement, st: Number(e.status) }));
}

// ── 3) Contratos ─────────────────────────────────────────────────────────────
function compactarContrato(c) {
  return {
    id: String(c.idMemberMemberShip ?? c.idMemberMembership ?? `${c.idMember}_${c.membershipStart}`),
    m: Number(c.idMember), nm: String(c.name || '').trim(), plano: String(c.nameMembership || '').trim(),
    v: Number(c.saleValue) || 0, ini: c.membershipStart || null, fim: c.membershipEnd || null,
    canc: c.cancelDate || null, regCanc: c.registerCancelDate || null,
    rec: (c.receivables || []).map(r => ({ due: r.dueDate || null, amt: Number(r.ammount) || 0, paid: Number(r.ammountPaid) || 0, recv: r.receivingDate || null, canc: !!r.canceled, tot: Number(r.totalInstallments) || 0, tipo: (r.paymentType && r.paymentType.name) || '' })),
  };
}

async function syncMes(ano, mes, { log = console.log, completo = false } = {}) {
  if (!evo.configurado()) throw new Error('EVO_DNS/EVO_TOKEN não configurados no .env do robô.');
  const t0 = Date.now();
  const mm = String(mes).padStart(2, '0');
  const hoje = hojeSP();
  gravarStatus({ rodando: true, inicio: new Date().toISOString(), mes: `${ano}-${mm}`, etapa: 'grade de aulas' });
  log(`💰 Pagamento: lendo o EVO de ${mm}/${ano}${completo ? ' (completo)' : ''}…`);

  // 1) grade de aulas
  const antigo = lerMes(ano, mes) || { listas: {} };
  const aulas = await lerGradeDoMes(ano, mes);
  log(`   📅 ${aulas.length} aulas no mês.`);

  // 2) listas: aulas que já aconteceram. Relê as dos últimos 10 dias (presença
  //    corrigida depois) e as que ainda não foram lidas; "completo" relê todas.
  const listas = antigo.listas || {};
  const limiteReler = (() => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 10); return d.toISOString().slice(0, 10); })();
  const paraLer = aulas.filter(a => a.s != null && a.d <= hoje && (completo || !listas[a.s] || a.d >= limiteReler));
  gravarStatus({ etapa: `listas das aulas (0/${paraLer.length})` });
  let i = 0, falhas = 0;
  for (const a of paraLer) {
    try { listas[a.s] = { em: new Date().toISOString(), e: await lerListaDaAula(a.s) }; }
    catch (e) { falhas++; if (falhas <= 3) log(`   ⚠️  lista da aula ${a.d} ${a.h} (${a.n}): ${e.message}`); }
    if (++i % 25 === 0) { gravarStatus({ etapa: `listas das aulas (${i}/${paraLer.length})` }); gravarJson(arqMes(ano, mes), { atualizadoEm: new Date().toISOString(), aulas, listas }); }
  }
  gravarJson(arqMes(ano, mes), { atualizadoEm: new Date().toISOString(), aulas, listas });
  log(`   👥 ${paraLer.length - falhas} listas lidas${falhas ? `, ${falhas} falharam` : ''}.`);

  // 3) contratos: os ativos + os cancelados a partir do 1º dia do mês
  gravarStatus({ etapa: 'contratos' });
  const ativos = await evo.paginado('/api/v3/membermembership', { statusMemberMembership: 1 });
  const cancelados = await evo.paginado('/api/v3/membermembership', { statusMemberMembership: 2, cancelDateStart: `${ano}-${mm}-01` });
  const cont = lerContratos(); const porMembro = cont.porMembro || {};
  const novos = {};
  for (const c of ativos.concat(cancelados)) {
    const k = compactarContrato(c); if (!k.m) continue;
    (novos[k.m] = novos[k.m] || {})[k.id] = k;
  }
  for (const m of Object.keys(novos)) porMembro[m] = { em: new Date().toISOString(), c: Object.values(novos[m]) };
  log(`   📄 ${ativos.length} contratos ativos e ${cancelados.length} cancelados no mês.`);

  // Quem aparece nas aulas e não tem contrato vigente no mês (o bulk do EVO às
  // vezes traz só contratos antigos, ou omite RECORRENTE): busca individual.
  const iniMes = new Date(ano, mes - 1, 1), fimMes = new Date(ano, mes, 0, 23, 59, 59);
  const vigente = (c) => { const ini = c.ini ? new Date(c.ini) : null; const fim = c.fim ? new Date(c.fim) : null; return !!ini && ini <= fimMes && (!fim || fim >= iniMes); };
  const nasAulas = new Set();
  for (const s of Object.keys(listas)) for (const e of (listas[s].e || [])) nasAulas.add(e.m);
  const faltando = [...nasAulas].filter(m => { const cs = (porMembro[m] && porMembro[m].c) || []; return !cs.some(vigente) || cs.every(c => /circuito/i.test(c.plano)); });
  gravarStatus({ etapa: `contratos individuais (${faltando.length})` });
  for (const m of faltando) {
    try { const cs = await evo.paginado('/api/v3/membermembership', { idMember: m }); if (cs.length) porMembro[m] = { em: new Date().toISOString(), c: cs.map(compactarContrato) }; }
    catch (e) { log(`   ⚠️  contratos da aluna ${m}: ${e.message}`); }
  }
  gravarJson(ARQ_CONTRATOS, { atualizadoEm: new Date().toISOString(), porMembro });
  log(`   🔎 ${faltando.length} aluna(s) com contrato buscado individualmente.`);

  // 4) grade FIXA: de quem tem contrato vigente no mês ou aparece nas aulas.
  //    Relê quem não foi lida nos últimos 6 dias (ou todas no "completo").
  const gr = lerGrades(); const gPor = gr.porMembro || {};
  const alvo = new Set(nasAulas);
  for (const m of Object.keys(porMembro)) if ((porMembro[m].c || []).some(c => vigente(c) && !c.canc)) alvo.add(Number(m));
  const corte = Date.now() - 6 * 864e5;
  const ler = [...alvo].filter(m => completo || !gPor[m] || Date.parse(gPor[m].em || '') < corte);
  gravarStatus({ etapa: `grade fixa das alunas (0/${ler.length})` });
  i = 0;
  for (const m of ler) {
    try {
      const r = await evo.chamar('/api/v1/activities/enrollment/member-enrollment', { idMember: m });
      const lista = Array.isArray(r) ? r : [];
      gPor[m] = { em: new Date().toISOString(), g: lista.filter(g => g && g.idActivity && g.weekDay != null && g.startTime).map(g => ({ a: g.idActivity, n: String(g.activityName || ''), wd: Number(g.weekDay), h: hhmm(g.startTime), st: Number(g.status), ini: g.startDate || null, fim: g.endDate || null })) };
    } catch (e) { if (i < 3) log(`   ⚠️  grade da aluna ${m}: ${e.message}`); }
    if (++i % 40 === 0) { gravarStatus({ etapa: `grade fixa das alunas (${i}/${ler.length})` }); gravarJson(ARQ_GRADES, { atualizadoEm: new Date().toISOString(), porMembro: gPor }); }
  }
  gravarJson(ARQ_GRADES, { atualizadoEm: new Date().toISOString(), porMembro: gPor });
  const seg = Math.round((Date.now() - t0) / 1000);
  log(`   🗓️  grade fixa de ${ler.length} aluna(s) atualizada. Pronto em ${seg} s.`);
  gravarStatus({ rodando: false, fim: new Date().toISOString(), etapa: '', ok: true, erro: '', segundos: seg, mes: `${ano}-${mm}` });
  return { aulas: aulas.length, listas: paraLer.length - falhas, contratos: ativos.length + cancelados.length, grades: ler.length, segundos: seg };
}

// Job da madrugada: mês atual (e, nos 5 primeiros dias, também o mês anterior,
// que é o que vai ser pago).
async function runPagamentoSync({ log = console.log, completo = false, ano, mes } = {}) {
  try {
    if (ano && mes) return await syncMes(ano, mes, { log, completo });
    const h = hojeSP(); const a = +h.slice(0, 4), m = +h.slice(5, 7), d = +h.slice(8, 10);
    const res = [];
    if (d <= 5) { const pm = m === 1 ? 12 : m - 1, pa = m === 1 ? a - 1 : a; res.push(await syncMes(pa, pm, { log, completo })); }
    res.push(await syncMes(a, m, { log, completo }));
    return res;
  } catch (e) {
    gravarStatus({ rodando: false, fim: new Date().toISOString(), ok: false, erro: e.message });
    throw e;
  }
}

module.exports = { runPagamentoSync, syncMes, lerMes, lerContratos, lerGrades, lerStatus, DIR };

if (require.main === module) {
  const arg = (process.argv.find(a => /^\d{4}-\d{2}$/.test(a)) || '');
  const op = arg ? { ano: +arg.slice(0, 4), mes: +arg.slice(5, 7) } : {};
  runPagamentoSync({ ...op, completo: process.argv.includes('--completo') }).then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
}
