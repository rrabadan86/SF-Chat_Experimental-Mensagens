// Datas difíceis: 1º do mês, fim do mês (fevereiro, ano bissexto), 1º de janeiro,
// domingo e a virada do dia em Brasília (UTC já está no dia seguinte). O "hoje" fica
// FIXO pelo relógio único (relogio.js: SF_AGORA, só com NODE_ENV=test).
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado } = require('../ajuda');

// Fixa o relógio durante fn (só vale com NODE_ENV=test).
function comAgora(iso, fn) {
  const antes = { e: process.env.NODE_ENV, a: process.env.SF_AGORA };
  process.env.NODE_ENV = 'test'; process.env.SF_AGORA = iso;
  try { return fn(); } finally {
    if (antes.e === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antes.e;
    if (antes.a === undefined) delete process.env.SF_AGORA; else process.env.SF_AGORA = antes.a;
  }
}

test('relógio: o "hoje" é o de Brasília na virada do ano (UTC já é 1º/1) e só se fixa em teste', () => {
  const amb = ambienteIsolado();
  try {
    const r = amb.req('relogio');
    comAgora('2027-01-01T02:30:00Z', () => { // 31/12 às 23:30 em Brasília
      assert.strictEqual(r.hojeSP(), '2026-12-31');
      assert.strictEqual(r.hojeSP(1), '2027-01-01', 'amanhã já é o ano novo');
      assert.strictEqual(r.horaSP(), 23);
    });
    comAgora('2027-01-01T03:00:00Z', () => assert.strictEqual(r.hojeSP(), '2027-01-01'));
    assert.strictEqual(r.diaSemana('2026-11-29'), 0, 'domingo');
    // fora de teste o SF_AGORA é ignorado: em produção o relógio é sempre o de verdade
    const antes = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; process.env.SF_AGORA = '2001-01-01T12:00:00Z';
    try { assert.notStrictEqual(r.hojeSP(), '2001-01-01'); } finally { delete process.env.SF_AGORA; if (antes === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antes; }
  } finally { amb.limpar(); }
});

test('ALU-02 "vence hoje": segunda cobre o domingo sem disparo, inclusive na virada de fevereiro para março', () => {
  const amb = ambienteIsolado();
  try {
    const v = amb.req('vence-hoje');
    // padrão: dispara seg–sáb → na segunda 01/03/2027 entra quem venceu no domingo 28/02
    assert.deepStrictEqual(comAgora('2027-03-01T09:17:00-03:00', () => v.datasCobertas()), ['2027-03-01', '2027-02-28']);
    assert.deepStrictEqual(v.datasCobertas('2027-03-02'), ['2027-03-02'], 'terça: só o próprio dia');
    assert.strictEqual(v.textoVencimento('2027-02-28', '2027-03-01'), 'venceu ontem');
    assert.strictEqual(v.textoVencimento('2026-12-31', '2027-01-01'), 'venceu ontem', 'ontem na virada do ano');
    assert.strictEqual(v.textoVencimento('2026-12-30', '2027-01-01'), 'venceu no dia 30/12');
    assert.strictEqual(v.textoVencimento('2027-01-01', '2027-01-01'), 'vence hoje');
  } finally { amb.limpar(); }
});

test('IND-06 metas: fevereiro de ano bissexto e o fechamento de dezembro em janeiro do ano seguinte', () => {
  const amb = ambienteIsolado();
  try {
    const m = amb.req('metas');
    assert.strictEqual(m.diasNoMes('2028-02'), 29);
    assert.strictEqual(m.diasNoMes('2027-02'), 28);
    assert.strictEqual(m.diasNoMes('2026-12'), 31);
    assert.strictEqual(m.podeFechar('2026-12', '2027-01-08', 7), false, 'dia 8: ainda dentro da tolerância');
    assert.strictEqual(m.podeFechar('2026-12', '2027-01-09', 7), true, 'dezembro fecha em 9 de janeiro');
    assert.strictEqual(m.podeFechar('2027-02', '2027-03-08', 7), false);
    assert.strictEqual(m.podeFechar('2027-02', '2027-03-09', 7), true);
  } finally { amb.limpar(); }
});

test('ALU-05 "Sentimos sua falta": a contagem de dias atravessa fevereiro e o mês da 2ª mensagem', () => {
  const amb = ambienteIsolado();
  try {
    const s = amb.req('sentimos-falta');
    const tel = '62999990001';
    const reg = { alunas: {} };
    const hoje = '2027-03-04'; // quinta
    const r = s.decidir([{ nome: 'Ana Souza', ultima: '18/02/2027', telefone: tel }, { nome: 'Bia Lima', ultima: '19/02/2027', telefone: tel }], { hoje, reg });
    const por = Object.fromEntries(r.map(x => [x.nome, x]));
    assert.strictEqual(por['Ana Souza'].dias, 14); assert.strictEqual(por['Ana Souza'].etapa, 1, '14 dias (fev. tem 28): recebe a 1ª');
    assert.strictEqual(por['Bia Lima'].dias, 13); assert.strictEqual(por['Bia Lima'].etapa, 0, '13 dias: ainda não');
    // 2ª mensagem 10 dias depois da 1ª, contando a virada do mês
    const reg2 = { alunas: { 'ana souza': { ultima: '18/02/2027', m1: '2027-02-22T10:37:00-03:00' } } };
    assert.strictEqual(s.decidir([{ nome: 'Ana Souza', ultima: '18/02/2027', telefone: tel }], { hoje: '2027-03-04', reg: reg2 })[0].etapa, 2);
    assert.strictEqual(s.decidir([{ nome: 'Ana Souza', ultima: '18/02/2027', telefone: tel }], { hoje: '2027-03-03', reg: reg2 })[0].etapa, 0, '9 dias depois da 1ª: ainda não');
  } finally { amb.limpar(); }
});

test('CONF-02 confirmação: a hora da aula é a de Brasília, também na noite de 31/12', () => {
  const amb = ambienteIsolado();
  try {
    const c = amb.req('confirmacao-sem-resposta');
    assert.strictEqual(c.aulaMs({ dataAula: '2026-12-31', horario: '23:30' }), Date.parse('2027-01-01T02:30:00Z'));
    assert.strictEqual(c.aulaMs({ dataAula: '2027-03-01', horario: '7:00' }), Date.parse('2027-03-01T10:00:00Z'), 'hora com um dígito');
    assert.strictEqual(c.aulaMs({ dataAula: '', horario: '07:00' }), 0, 'sem data não inventa hora');
  } finally { amb.limpar(); }
});
