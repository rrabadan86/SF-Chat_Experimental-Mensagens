// Metas, ritmo do mês e fechamento mensal (metas.js): a conta do "no ritmo", a
// meta que vale para o mês e a foto do mês fechado, que não pode mudar depois.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado } = require('../ajuda');

test('ritmo: compara o realizado com o esperado até hoje', () => {
  const amb = ambienteIsolado();
  try {
    const { ritmo } = amb.req('metas');
    // meta de 30 entradas, dia 20 de 30: esperado 20
    assert.strictEqual(ritmo({ tipo: 'soma', meta: 30, real: 20, fracao: 20 / 30 }).status, 'ritmo');
    assert.strictEqual(ritmo({ tipo: 'soma', meta: 30, real: 19.2, fracao: 20 / 30 }).status, 'ritmo', '5% de folga');
    const abaixo = ritmo({ tipo: 'soma', meta: 30, real: 12, fracao: 20 / 30 });
    assert.strictEqual(abaixo.status, 'abaixo');
    assert.strictEqual(Math.round(abaixo.esperado), 20);
    assert.strictEqual(Math.round(abaixo.projecao), 18, 'nesse ritmo fecha em 18');
    assert.strictEqual(ritmo({ tipo: 'soma', meta: 30, real: 31, fracao: 0.5 }).status, 'batida');
    // alunas ativas: de 200 (começo do mês) até 220; na metade do mês o esperado é 210
    assert.strictEqual(Math.round(ritmo({ tipo: 'nivel', meta: 220, real: 205, fracao: 0.5, ini: 200 }).esperado), 210);
    assert.strictEqual(ritmo({ tipo: 'nivel', meta: 220, real: 205, fracao: 0.5, ini: 200 }).status, 'abaixo');
    assert.strictEqual(ritmo({ tipo: 'nivel', meta: 220, real: 210, fracao: 0.5, ini: 200 }).status, 'ritmo');
    // começou acima da meta: o esperado é a própria meta
    assert.strictEqual(ritmo({ tipo: 'nivel', meta: 140, real: 141, fracao: 0.5, ini: 150 }).status, 'batida');
    assert.strictEqual(ritmo({ tipo: 'nivel', meta: 140, real: 130, fracao: 0.5, ini: 150 }).esperado, 140);
    // sem meta ou sem dado: não inventa status
    assert.strictEqual(ritmo({ tipo: 'soma', meta: null, real: 5, fracao: 0.5 }).status, 'sem');
    assert.strictEqual(ritmo({ tipo: 'soma', meta: 30, real: null, fracao: 0.5 }).status, 'sem');
  } finally { amb.limpar(); }
});

test('metas: valem para os meses seguintes e recusam valor inválido', () => {
  const amb = ambienteIsolado();
  try {
    const m = amb.req('metas');
    assert.deepStrictEqual(m.metasDoMes('2026-11').valores, {});
    m.salvarMetas('2026-10', { ativas: '210', entradas: '25', recebido: '85.500,50', ocupacao: '' });
    const nov = m.metasDoMes('2026-11');
    assert.strictEqual(nov.herdada, true);
    assert.strictEqual(nov.de, '2026-10');
    assert.deepStrictEqual(nov.valores, { ativas: 210, entradas: 25, recebido: 85500.5 });
    assert.deepStrictEqual(m.metasDoMes('2026-09').valores, {}, 'meta não vale para trás');
    m.salvarMetas('2026-11', { ativas: '220' });
    assert.deepStrictEqual(m.metasDoMes('2026-11').valores, { ativas: 220 });
    assert.strictEqual(m.metasDoMes('2026-11').herdada, false);
    assert.throws(() => m.salvarMetas('2026-11', { ativas: '-3' }), /não é um número válido/);
    assert.throws(() => m.salvarMetas('2026-11', { ocupacao: '120' }), /máximo é 100/);
    assert.throws(() => m.salvarMetas('11/2026', { ativas: '1' }), /mês inválido/);
    assert.deepStrictEqual(m.metasDoMes('2026-11').valores, { ativas: 220 }, 'erro não altera o que estava salvo');
  } finally { amb.limpar(); }
});

test('IND-06 fechamento: só fecha depois da tolerância de renovação e a foto não muda', () => {
  const amb = ambienteIsolado();
  try {
    const m = amb.req('metas');
    assert.strictEqual(m.diaDeFechar('2026-10', 7), '2026-11-09');
    assert.strictEqual(m.diaDeFechar('2026-12', 7), '2027-01-09');
    assert.strictEqual(m.podeFechar('2026-10', '2026-11-08', 7), false, 'ainda dá para renovar sem contar como saída');
    assert.strictEqual(m.podeFechar('2026-10', '2026-11-09', 7), true);
    assert.strictEqual(m.fechar('2026-10', { ativas: { fim: 210, sairam: 12 } }, '2026-11-09T08:00:00.000Z'), true);
    assert.strictEqual(m.fechar('2026-10', { ativas: { fim: 999, sairam: 0 } }), false, 'mês fechado não é regravado');
    assert.strictEqual(m.fechamentos()['2026-10'].ativas.fim, 210);
    assert.strictEqual(m.fechamentos()['2026-10'].fechadoEm, '2026-11-09T08:00:00.000Z');
  } finally { amb.limpar(); }
});

test('posição do mês: guarda a leitura mais recente e não troca por uma mais velha', () => {
  const amb = ambienteIsolado();
  try {
    const m = amb.req('metas');
    assert.strictEqual(m.registrarPosicao('2026-11', 'fin', { recebido: 100 }, '2026-11-10 05:40'), true);
    assert.strictEqual(m.registrarPosicao('2026-11', 'fin', { recebido: 300 }, '2026-11-20 05:40'), true);
    assert.strictEqual(m.registrarPosicao('2026-11', 'fin', { recebido: 50 }, '2026-11-05 05:40'), false);
    assert.strictEqual(m.registrarPosicao('2026-11', 'grade', { ocupacaoPct: 72 }, '2026-11-20 05:40'), true);
    const p = m.posicoes()['2026-11'];
    assert.strictEqual(p.fin.recebido, 300);
    assert.strictEqual(p.grade.ocupacaoPct, 72);
    assert.strictEqual(m.registrarPosicao('11/2026', 'fin', { recebido: 1 }, 'x'), false);
  } finally { amb.limpar(); }
});

test('IND-06 tela de Metas: tira a foto dos meses fechados e mantém depois que os dados mudam', () => {
  const amb = ambienteIsolado();
  try {
    // histórico de alunas ativas de 01/09 a 20/11: 1 entrada por dia, 1 saída a cada 2 dias
    const ini = Date.parse('2026-09-01T12:00:00Z'), n = 81, ativas = [], entraram = [], novas = [], sairam = [];
    let a = 200;
    for (let i = 0; i < n; i++) { const e = 1, s = i % 2; a += e - s; ativas.push(a); entraram.push(e); novas.push(e); sairam.push(s); }
    amb.gravarData('alunas-ativas-historico.json', { reconstruido: { inicio: '2026-09-01', ativas, entraram, novas, sairam, tolerancia: 7 }, pessoas: {} });
    assert.strictEqual(new Date(ini + (n - 1) * 86400000).toISOString().slice(0, 10), '2026-11-20');
    amb.gravarSofia('sofia-conversas.json', {});
    amb.gravarSofia('sofia-historico.json', {});
    amb.gravarSofia('sofia-tag-log.jsonl', '');
    const pm = amb.req('painel-metas'), m = amb.req('metas');
    const html = pm.paginaMetas({});
    assert.ok(/Metas do mês/.test(html));
    const f = m.fechamentos();
    // setembro é o primeiro mês do histórico (pode estar pela metade): não fecha. Outubro fecha (20/11 ≥ 09/11).
    assert.deepStrictEqual(Object.keys(f), ['2026-10']);
    assert.strictEqual(f['2026-10'].ativas.entraram, 31);
    assert.strictEqual(f['2026-10'].funil, null, 'sem histórico de agendamentos no mês: não inventa zero');
    const foto = JSON.stringify(f['2026-10']);
    // o histórico é recalculado com outros números: a foto continua igual
    amb.gravarData('alunas-ativas-historico.json', { reconstruido: { inicio: '2026-09-01', ativas: ativas.map(x => x + 50), entraram: entraram.map(() => 3), novas, sairam, tolerancia: 7 }, pessoas: {} });
    pm.rotina(true);
    assert.strictEqual(JSON.stringify(m.fechamentos()['2026-10']), foto);
  } finally { amb.limpar(); }
});
