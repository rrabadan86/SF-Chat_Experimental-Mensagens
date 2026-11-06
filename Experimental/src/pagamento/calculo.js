/**
 * pagamento/calculo.js — cálculo da remuneração dos professores por aula.
 *
 * Porte do sf-pagamento (app/api/calculo/route.ts) com as correções combinadas
 * com o Studio (06/11/2026):
 *   - Contam no valor da aula TODAS as alunas FIXAS matriculadas na turma
 *     (presentes ou não — por isso o feriado/aula vazia ainda pode passar do piso)
 *     + as PRESENTES de Free/avulsa/reposição. Não há mais o corte "9 primeiras
 *     em ordem alfabética". Mais de 9 presenças numa aula = aviso (o Studio só
 *     comporta 9 → lançamento errado no EVO).
 *   - Fixa: contribuição por aula = mensalidade × (1 − desconto) × % ÷ nº REAL de
 *     aulas que ela tem no mês (contadas na grade do mês pela turma dela). Antes
 *     era frequência × dias/7 (ex.: 1x num mês com 5 segundas dividia por 4).
 *   - Aula com valor abaixo do piso recebe o piso; acima do teto, o teto.
 *   - Sábado: diária fixa (padrão R$70), uma por sábado, mesmo com várias aulas.
 *   - Aluna que não pagou CONTA para o professor (o "pagou" é só informativo).
 *   - Professor identificado pelo código do EVO (não pelo nome).
 *   - Regras (Free R$11, sábado, desconto 3%, padrões, VIPs que não contam)
 *     configuráveis na tela.
 */
const sync = require('./sync');
const pcfg = require('./config');
const ajustesMod = require('./ajustes');

const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const round2 = (v) => Math.round(v * 100) / 100;
const norm = pcfg.norm;
const dowDe = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const dataLocal = (s) => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const diaNum = (s) => { const d = dataLocal(s); return d ? d.getTime() : null; };

function tipoDePlano(nome) {
  const l = String(nome || '').toLowerCase();
  if (l.includes('free') || l.includes('vip')) return 'free';
  if (l.includes('fixa') || l.includes('recorrente')) return 'fixo';
  if (l.includes('avulsa') || l.includes('pacote') || l.includes('aulas')) return 'free';
  return 'fixo';
}
function statusContrato(c, ref) {
  if (c.canc) return 'Cancelado';
  if (c.regCanc) return 'Suspenso';
  if (ref && c.fim) { const f = new Date(c.fim); if (!isNaN(f) && f < ref) return 'Cancelado'; }
  return 'Ativo';
}
// Pagou o mês de referência? (só informativo — devedora conta para o professor)
// null = sem dados de parcelas. Plano pago à vista/adiantado (todas as parcelas
// válidas pagas e nenhuma vencendo no mês) conta como pago.
function pagouNoMes(contratos, ano, mes) {
  const rec = contratos.flatMap(c => c.rec || []).filter(r => !r.canc && r.amt > 0 && r.tipo !== 'SaldoDevedor');
  if (!rec.length) return null;
  const pago = (r) => r.paid > 0 || !!r.recv;
  const ym = (d) => d ? (+d.slice(0, 4)) * 12 + (+d.slice(5, 7) - 1) : null;
  const ref = ano * 12 + (mes - 1);
  const doMes = rec.filter(r => ym(r.due) === ref);
  if (doMes.length) return doMes.some(pago);
  if (rec.every(pago) && rec.some(r => ym(r.due) !== null && ym(r.due) <= ref)) return true;
  return false;
}

// Mensalidade (valor de 1 mês) a partir do contrato — mesma lógica do sf-pagamento.
function valorMensal(c) {
  const n = String(c.plano || '').toLowerCase();
  let meses = 0;
  if (n.includes('anual')) meses = 12;
  else if (n.includes('semestral')) meses = 6;
  else if (n.includes('trimestral') || n.includes('trim.') || / trm |^trm | trm/.test(n)) meses = 3;
  else if (n.includes('bimestral')) meses = 2;
  else if (n.includes('mensal')) meses = 1;
  if (meses) return c.v / meses;
  let dur = 0;
  if (c.ini && c.fim) dur = Math.round((new Date(c.fim) - new Date(c.ini)) / 864e5 / 30.44);
  const rec = (c.rec || []).find(r => !r.canc && r.tot > 1);
  if (dur >= 2 && dur <= 24) return c.v / dur;
  if (dur === 1) return c.v;
  if (rec && rec.tot <= 24) return c.v / rec.tot;
  if (c.ini) { const d = new Date(c.ini); if (d.getFullYear() >= 2026 || (d.getFullYear() === 2025 && d.getMonth() >= 6)) return c.v / 12; }
  return c.v;
}
// Frequência semanal pelo nome do plano ("3X", "2x", "GRUPO 2").
function freqDoPlano(nome) {
  const s = String(nome || '').toUpperCase();
  let f = 0; for (const x of s.match(/(\d+)\s*X/g) || []) f += parseInt(x, 10);
  if (!f) { const g = /GRUPO\s*(\d+)/.exec(s); if (g) f = parseInt(g[1], 10); }
  return f;
}

function calcularMes(ano, mes, { cfg = pcfg.ler() } = {}) {
  const ym = `${ano}-${String(mes).padStart(2, '0')}`;
  const aj = ajustesMod.ler(ym);
  const dados = sync.lerMes(ano, mes);
  if (!dados) return { ok: false, erro: `Ainda não há dados de ${String(mes).padStart(2, '0')}/${ano}. Clique em "Atualizar dados do EVO".`, ym };
  const R = cfg.regras;
  const vip = (R.vipZero || []).map(norm).filter(Boolean);
  const ehVip = (nome) => { const n = norm(nome); return vip.some(v => n.includes(v)); };
  const contratos = (sync.lerContratos().porMembro) || {};
  const gradesPor = (sync.lerGrades().porMembro) || {};
  const aulas = dados.aulas || [], listas = dados.listas || {};
  const iniMes = new Date(ano, mes - 1, 1), fimMes = new Date(ano, mes, 0, 23, 59, 59);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const vigenteNoMes = (c) => { const i = c.ini ? new Date(c.ini) : null; const f = c.fim ? new Date(c.fim) : null; return !!i && i <= fimMes && (!f || f >= iniMes); };
  const turmaDe = (a) => `${a.n} - ${a.h}`;
  const vagaDe = (a) => `${turmaDe(a)}|${dowDe(a.d)}`; // turma num dia da semana (ex.: SLIMFIT A 07:00 às quartas)
  const chaveProf = (a) => a.pi ? a.pi : 'nome:' + norm(a.p || 'sem professor');

  // Grade fixa de cada aluna (vale na data da aula: dia da semana + horário + vigência).
  const grade = new Map();
  for (const m of Object.keys(gradesPor)) { const g = (gradesPor[m].g || []); if (g.length) grade.set(Number(m), g); }
  const ehDaGrade = (g, a) => g.some(x => x.wd === dowDe(a.d) && String(x.h).slice(0, 5) === a.h && (diaNum(x.ini) ?? 0) <= diaNum(a.d) && diaNum(a.d) <= (x.fim ? diaNum(x.fim) : Infinity));

  // Aulas do mês de cada turma e de cada vaga (turma + dia da semana).
  const aulasDaTurma = new Map(), aulasDaVaga = new Map();
  for (const a of aulas) {
    const k = turmaDe(a); (aulasDaTurma.get(k) || aulasDaTurma.set(k, []).get(k)).push(a);
    const v = vagaDe(a); (aulasDaVaga.get(v) || aulasDaVaga.set(v, []).get(v)).push(a);
  }

  // RECORRENTE sem grade no EVO: vaga (turma + dia da semana) com 2+ aparições
  // (não reposição) no mês = matriculada. Pelo dia da semana: a aluna 1x de quarta
  // não "faz" a segunda da mesma turma.
  const inferidas = new Map();
  { const cont = new Map();
    for (const a of aulas) {
      const l = listas[a.s]; if (!l) continue;
      for (const e of l.e || []) {
        if (grade.has(e.m) || e.r) continue;
        const t = cont.get(e.m) || new Map(); t.set(vagaDe(a), (t.get(vagaDe(a)) || 0) + 1); cont.set(e.m, t);
      }
    }
    for (const [m, t] of cont) {
      const cs = (contratos[m] && contratos[m].c) || [];
      if (!cs.some(c => tipoDePlano(c.plano) === 'fixo')) continue;
      const mat = [...t].filter(([, n]) => n >= 2).map(([k]) => k);
      if (mat.length) inferidas.set(m, new Set(mat));
    }
  }

  // Quantas aulas a aluna FIXA tem no mês (pela grade dela, ou pelas turmas inferidas).
  const cacheAulasDela = new Map();
  function aulasNoMesDela(m, plano, turmaAtual) {
    if (cacheAulasDela.has(m)) return cacheAulasDela.get(m);
    let n = 0, fonte = '';
    const g = grade.get(m);
    if (g) { n = aulas.filter(a => ehDaGrade(g, a)).length; fonte = 'grade'; }
    else if (inferidas.has(m)) { for (const k of inferidas.get(m)) n += (aulasDaVaga.get(k) || []).length; fonte = 'presença'; }
    if (!n) { const f = freqDoPlano(plano); if (f) { n = Math.round(f * diasNoMes / 7); fonte = 'plano'; } }
    if (!n) { n = (aulasDaTurma.get(turmaAtual) || []).length; fonte = 'turma'; }
    const r = { n, fonte }; cacheAulasDela.set(m, r); return r;
  }

  // Escolhe o contrato que vale para a aluna nesta aula (mesma pontuação do sf-pagamento).
  function escolherContrato(cs, turma, dataAula) {
    let lista = cs.slice();
    const circ = /circuito/i.test(turma);
    if (!circ) { const s = lista.filter(c => !/circuito/i.test(c.plano)); if (s.length) lista = s; }
    const semAv = lista.filter(c => !/aulas|avulsa|pacote/i.test(c.plano)); if (semAv.length) lista = semAv;
    const tl = turma.toLowerCase();
    const score = (c) => {
      const n = c.plano.toLowerCase(); let s = 0;
      if (tl.includes('slimfit') && n.includes('slimfit')) s += 10;
      if (tl.includes('circuito') && n.includes('circuito')) s += 10;
      if (tipoDePlano(c.plano) === 'fixo') s += 5;
      if (statusContrato(c, dataAula) === 'Ativo') s += 2;
      const i = c.ini ? new Date(c.ini) : new Date(0), f = c.fim ? new Date(c.fim) : new Date(0);
      if (i <= dataAula && f >= dataAula) s += 20;
      return s;
    };
    lista.sort((a, b) => {
      const d = score(b) - score(a); if (d) return d;
      const va = a.v > 0 ? 1 : 0, vb = b.v > 0 ? 1 : 0; if (va !== vb) return vb - va;
      return (b.fim ? new Date(b.fim) : new Date(0)) - (a.fim ? new Date(a.fim) : new Date(0));
    });
    return lista[0];
  }

  const porProf = new Map();
  const avisos = [];
  let semLista = 0;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  // Ajustes do mês (guardados): horários ocultos (seg–sex), exclusões e inclusões.
  const ocultos = new Set((aj.ocultos || []).map(x => x.h));
  const exclusaoDe = (m, kp, s) => (aj.exclusoes || []).find(x => x.m === m && (x.escopo === 'global' || (x.escopo === 'prof' && x.prof === kp) || (x.escopo === 'sessao' && x.prof === kp && String(x.s) === String(s)))) || null;
  const insercoesPorSessao = new Map();
  for (const x of aj.insercoes || []) (insercoesPorSessao.get(String(x.s)) || insercoesPorSessao.set(String(x.s), []).get(String(x.s))).push(x);
  const alunasMes = new Map(); // idMember → resumo para a "Gestão Central"
  const DSEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  function diasDela(m) {
    const g = grade.get(m), out = new Set();
    if (g) for (const x of g) { if ((diaNum(x.ini) ?? 0) <= fimMes.getTime() && (x.fim ? diaNum(x.fim) : Infinity) >= iniMes.getTime()) out.add(`${DIAS[x.wd]} ${String(x.h).slice(0, 5).replace(':', 'h')}`); }
    else if (inferidas.has(m)) for (const k of inferidas.get(m)) { const [t, wd] = k.split('|'); out.add(`${DIAS[+wd]} ${t.slice(-5).replace(':', 'h')}`); }
    return [...out];
  }

  for (const a of aulas) {
    if (ocultos.has(a.h) && dowDe(a.d) >= 1 && dowDe(a.d) <= 5) continue; // horário tirado do cálculo na matriz
    const turma = turmaDe(a);
    const dataAula = dataLocal(a.d);
    const lista = listas[a.s];
    const kpAula = chaveProf(a);
    if (!lista && a.d <= hoje) semLista++;
    const st = new Map(); // idMember → { n, r, st, naLista }
    for (const e of (lista && lista.e) || []) st.set(e.m, { n: e.n, r: e.r, st: e.st, naLista: true });
    // Fixas da turma que não estão na lista (feriado, aula sem lançamento): contam como falta.
    for (const [m, g] of grade) if (!st.has(m) && ehDaGrade(g, a)) st.set(m, { n: '', r: false, st: 1, naLista: false });
    for (const [m, ts] of inferidas) if (!st.has(m) && ts.has(vagaDe(a))) st.set(m, { n: '', r: false, st: 1, naLista: false });
    // Incluídas à mão nesta aula: contam com o valor do plano delas.
    for (const x of insercoesPorSessao.get(String(a.s)) || []) {
      const ja = st.get(x.m);
      if (ja) ja.inserida = x; else st.set(x.m, { n: x.nome, r: false, st: 0, naLista: false, inserida: x });
    }

    const alunas = [];
    for (const [m, e] of st) {
      const presente = e.st === 0 || !!e.inserida;
      let cs = ((contratos[m] && contratos[m].c) || []).filter(c => !c.canc || new Date(c.canc) >= iniMes);
      if (!cs.length) {
        if (!presente) continue;
        cs = [{ id: 'avulsa', m, nm: e.n || 'Aluna avulsa', plano: 'Plano Avulso/VIP', v: 0, ini: '2000-01-01', fim: '2099-01-01', rec: [] }];
      }
      if (!cs.some(vigenteNoMes)) {
        // Contrato só no futuro (começa depois do mês) ou já encerrado → não é aluna deste mês.
        continue;
      }
      const c = escolherContrato(cs, turma, dataAula);
      const nome = c.nm || e.n || ('Aluna ' + m);
      const tipo = tipoDePlano(c.plano);
      const reg = { m, nome, tipo, plano: c.plano, status: statusContrato(c, dataAula), presenca: e.inserida && !e.naLista ? (e.st === 0 ? 'presente' : 'falta') : e.inserida ? 'incluída à mão' : !e.naLista ? (lista ? 'falta (não lançada)' : 'sem lista') : (e.st === 0 ? 'presente' : e.st === 2 ? 'falta justificada' : 'falta'), mensalidade: 0, contrib: 0, reposicao: false, pagou: pagouNoMes(cs.filter(vigenteNoMes), ano, mes), nota: '' };
      if (e.inserida) { reg.inserida = { id: e.inserida.id, por: e.inserida.por, motivo: e.inserida.motivo }; reg.nota = 'incluída à mão' + (e.inserida.motivo ? ': ' + e.inserida.motivo : ''); }
      { // resumo da aluna no mês (Gestão Central)
        const r0 = alunasMes.get(m) || { m, nome, tipo, plano: c.plano, pagou: reg.pagou, dias: diasDela(m), profs: new Map(), aulas: 0, excluidaGlobal: null };
        if (tipo === 'fixo' && r0.tipo !== 'fixo') { r0.tipo = 'fixo'; r0.plano = c.plano; }
        alunasMes.set(m, r0);
      }
      const exc = exclusaoDe(m, kpAula, a.s);
      if (exc) {
        Object.assign(reg, { contrib: 0, base: 0, excluida: { id: exc.id, escopo: exc.escopo, motivo: exc.motivo, por: exc.por }, nota: `excluída (${exc.escopo === 'global' ? 'de todas as aulas' : exc.escopo === 'prof' ? 'das aulas deste professor' : 'desta aula'}): ${exc.motivo}` });
        if (exc.escopo === 'global') alunasMes.get(m).excluidaGlobal = { id: exc.id, motivo: exc.motivo, por: exc.por };
        alunas.push(reg); continue;
      }
      if (tipo === 'fixo') {
        const vm = round2(valorMensal(c) * (1 - (R.descontoFixoPct || 0) / 100));
        reg.mensalidade = vm;
        // Reposição: fixa numa aula que não é a da turma dela.
        const g = grade.get(m);
        if (e.inserida) reg.reposicao = false; // incluída à mão: conta com o valor do plano
        else if (g) reg.reposicao = !ehDaGrade(g, a) || e.r;
        else if (e.r) reg.reposicao = true;
        else if (inferidas.has(m) && !inferidas.get(m).has(vagaDe(a))) reg.reposicao = true;
        if (reg.reposicao) {
          if (!presente) continue;
          // Fixa em reposição não gera valor — só se tiver um plano Free vigente (conta como Free).
          const free = cs.find(x => tipoDePlano(x.plano) === 'free' && vigenteNoMes(x));
          if (!free) { reg.nota = 'reposição (conta na turma dela)'; alunas.push(reg); continue; }
          Object.assign(reg, { tipo: 'free', plano: free.plano, mensalidade: 0, contrib: ehVip(nome) ? 0 : R.freeValor, nota: 'reposição com plano Free' });
          alunas.push(reg); continue;
        }
        const nA = aulasNoMesDela(m, c.plano, turma);
        reg.aulasMes = nA.n; reg.fonteAulas = nA.fonte;
        reg.base = nA.n ? vm / nA.n : 0; // R$ da mensalidade por aula; o % do professor entra na montagem
      } else {
        if (!presente) continue;
        reg.contrib = ehVip(nome) ? 0 : R.freeValor;
        if (ehVip(nome)) reg.nota = 'VIP (não conta)';
      }
      alunas.push(reg);
    }
    const presencas = alunas.filter(x => x.presenca === 'presente').length;
    const kp = kpAula;
    for (const al of alunas) { const r0 = alunasMes.get(al.m); if (r0) { r0.profs.set(kp, a.p || 'Sem professor'); r0.aulas++; } }
    if (!porProf.has(kp)) porProf.set(kp, { chave: kp, nome: a.p || 'Sem professor', aulas: [] });
    porProf.get(kp).aulas.push({ a, turma, alunas, presencas, temLista: !!lista });
  }

  // Monta por professor (o % dele entra agora: contribuição das fixas = base × %).
  const professores = [];
  for (const [kp, p] of porProf) {
    const v = pcfg.vigente(cfg, kp, ym);
    if (!v.configurado) avisos.push(`${p.nome}: sem percentual configurado — usando o padrão (${v.pct}% · piso R$${v.piso} · teto R$${v.teto}).`);
    const turmas = new Map(); const sabados = new Set(); let total = 0;
    for (const x of p.aulas.sort((u, w) => (u.a.d + u.a.h).localeCompare(w.a.d + w.a.h))) {
      const alunas = x.alunas.map(al => Object.assign({}, al, { contrib: round2(al.tipo === 'fixo' && !al.reposicao ? (al.base || 0) * v.pct / 100 : al.contrib) }));
      const bruto = round2(alunas.reduce((s, al) => s + al.contrib, 0));
      const sab = dowDe(x.a.d) === 6;
      let valor, regra;
      if (sab) {
        if (sabados.has(x.a.d)) { valor = 0; regra = 'diária do sábado já contada em outra aula'; }
        else { valor = R.sabadoValor; regra = 'diária do sábado'; sabados.add(x.a.d); }
      } else if (bruto < v.piso) { valor = v.piso; regra = 'piso'; }
      else if (bruto > v.teto) { valor = v.teto; regra = 'teto'; }
      else { valor = bruto; regra = ''; }
      const avs = [];
      if (x.presencas > R.capacidade) { avs.push(`${x.presencas} presenças (o Studio comporta ${R.capacidade}) — confira o lançamento no EVO`); avisos.push(`${p.nome} · ${x.a.d.split('-').reverse().join('/')} ${x.a.h} ${x.a.n}: ${x.presencas} presenças lançadas (máximo ${R.capacidade}).`); }
      if (!x.temLista && x.a.d <= hoje) avs.push('lista da aula ainda não lida do EVO');
      const t = turmas.get(x.turma) || { nome: x.turma, aulas: [], total: 0 };
      t.aulas.push({ s: x.a.s, wd: dowDe(x.a.d), data: x.a.d, dia: DIAS[dowDe(x.a.d)], hora: x.a.h, atividade: x.a.n, sabado: sab, bruto, valor: round2(valor), regra, presencas: x.presencas, futura: x.a.d > hoje, avisos: avs, alunas: alunas.sort((u, w) => u.nome.localeCompare(w.nome)) });
      t.total = round2(t.total + valor); total += valor;
      turmas.set(x.turma, t);
    }
    professores.push({ chave: kp, nome: p.nome, pct: v.pct, piso: v.piso, teto: v.teto, configurado: v.configurado, turmas: [...turmas.values()].sort((u, w) => u.nome.localeCompare(w.nome)), total: round2(total), nAulas: p.aulas.length });
  }
  if (semLista) avisos.push(`${semLista} aula(s) que já aconteceram estão sem a lista de presença lida do EVO — clique em "Atualizar dados do EVO".`);
  professores.sort((a, b) => a.nome.localeCompare(b.nome));
  // Exclusões/inclusões de cada professor (para o cartão e o relatório).
  for (const p of professores) {
    p.exclusoes = (aj.exclusoes || []).filter(x => x.escopo === 'global' ? p.turmas.some(t => t.aulas.some(au => au.alunas.some(al => al.m === x.m))) : x.prof === p.chave);
    p.insercoes = (aj.insercoes || []).filter(x => x.prof === p.chave);
  }
  const alunasLista = [...alunasMes.values()].map(x => Object.assign({}, x, { profs: [...x.profs.values()] })).sort((u, w) => u.nome.localeCompare(w.nome));
  return { ok: true, ym, ano, mes, atualizadoEm: dados.atualizadoEm, listasEm: Object.values(listas).reduce((mx, l) => (l.em && l.em > mx ? l.em : mx), ''), professores, total: round2(professores.reduce((s, p) => s + p.total, 0)), avisos, regras: R, alunas: alunasLista, ajustes: aj };
}

module.exports = { calcularMes, tipoDePlano, valorMensal, pagouNoMes, freqDoPlano };
