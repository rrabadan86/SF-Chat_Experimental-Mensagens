// Retenção (safras, motivo da saída, permanência), tempo de resposta à lead e
// custo de aquisição — as contas novas da auditoria, parte 3.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado } = require('../ajuda');

const HOJE = '2026-11-20';
const c = (ini, fim, resc) => [ini, fim, 'Plano', fim, resc ? 1 : 0];

test('safras: só mostra a casa quando a safra inteira já teve aquele tempo', () => {
  const { safras } = require('../../src/ativas-dados');
  const pessoas = {
    // safra de maio/2026: 4 alunas
    1: { iv: [['2026-05-02', '2026-12-31']] },                                // ficou
    2: { iv: [['2026-05-10', '2026-07-01']] },                                // saiu com menos de 3 meses
    3: { iv: [['2026-05-20', '2026-09-30']] },                                // passou dos 3, saiu antes dos 6
    4: { iv: [['2026-05-28', '2026-06-30'], ['2026-08-20', '2026-12-31']] },  // saiu e voltou: ativa aos 3 e aos 6 meses
    // safra de outubro/2026: ainda não completou 3 meses
    5: { iv: [['2026-10-05', '2027-01-05']] },
    // começou neste mês: não entra (mês em andamento)
    6: { iv: [['2026-11-03', '2027-02-03']] },
  };
  const s = safras(pessoas, HOJE, 15);
  assert.deepStrictEqual(s.map(x => x.k), ['2026-10', '2026-05']);
  const maio = s.find(x => x.k === '2026-05');
  assert.strictEqual(maio.n, 4);
  assert.strictEqual(maio.r3, 3, 'alunas 1, 3 e 4 estavam ativas 3 meses depois de começar');
  assert.strictEqual(maio.r6, null, 'quem começou em 31/05 só completa 6 meses em 30/11');
  assert.strictEqual(maio.r12, null);
  assert.strictEqual(s.find(x => x.k === '2026-10').r3, null, 'outubro ainda não tem 3 meses');
  // com a safra já madura, os 6 meses aparecem: só 1 e 4 continuavam
  assert.strictEqual(safras(pessoas, '2026-12-01', 15).find(x => x.k === '2026-05').r6, 2);
});

test('motivo da saída: separa quem não renovou de quem cancelou antes do fim', () => {
  const { motivosSaida, permanencia } = require('../../src/ativas-dados');
  const pessoas = {
    1: { iv: [['2026-01-01', '2026-09-30']], cs: [c('2026-01-01', '2026-09-30', false)] },   // não renovou → saída em outubro
    2: { iv: [['2026-03-01', '2026-10-14']], cs: [c('2026-03-01', '2026-10-14', true)] },    // cancelou → outubro
    // dois contratos seguidos; o último foi cancelado → outubro, rescisão
    3: { iv: [['2025-10-01', '2026-10-20']], cs: [c('2025-10-01', '2026-03-31', false), c('2026-04-01', '2026-10-20', true)] },
    4: { iv: [['2026-01-01', '2026-11-18']], cs: [c('2026-01-01', '2026-11-18', false)] },   // venceu há 2 dias: ainda pode renovar
    5: { iv: [['2026-01-01', '2026-12-31']], cs: [c('2026-01-01', '2026-12-31', false)] },   // ativa
  };
  const m = motivosSaida(pessoas, HOJE, 7);
  assert.deepStrictEqual(m['2026-10'], { naoRenovou: 1, rescindiu: 2 });
  assert.strictEqual(m['2026-11'], undefined, 'saída dentro da tolerância não entra');
  const p = permanencia(pessoas, HOJE, 12, 7);
  assert.strictEqual(p.saidas, 3);
  assert.strictEqual(p.ativas, 1);
  assert.ok(p.medianaSaidas > 8.5 && p.medianaSaidas < 9.5, 'mediana de ~9, ~7,5 e ~12,6 meses');
});

test('tempo de resposta: mede da primeira mensagem dela até a resposta, e lista quem espera', () => {
  const { tempos, esperando, fmtEspera } = require('../../src/atendimento');
  const t0 = Date.parse('2026-11-20T15:00:00-03:00'), MIN = 60000;
  const m = (autor, min, tipo) => ({ autor, texto: 'x', em: t0 + min * MIN, ...(tipo ? { tipo } : {}) });
  const conv = {
    a: { nome: 'Ana', msgs: [m('aluna', -300), m('aluna', -299), m('sofia', -298), m('aluna', -200), m('humano', -170)] },   // 2 min (SoFIA) e 30 min (equipe)
    b: { nome: 'Bia', msgs: [m('sofia', -400, 'followup'), m('aluna', -100), m('sofia', -99.5)] },                         // 30 s; o follow-up não é resposta
    c: { nome: 'Carla', msgs: [m('sofia', -90), m('aluna', -80), m('aluna', -70)] },                                       // esperando há 80 min
    d: { nome: 'Duda', msgs: [m('aluna', -5)] },                                                                           // há 5 min: ainda não conta
    e: { nome: 'Eva', msgs: [m('aluna', -60, 'automatica')] },                                                             // resposta automática do WhatsApp dela
    f: { nome: 'Fê', msgs: [m('aluna', -50)] },                                                                            // encerrada à mão
    g: { nome: 'Gi', msgs: [m('aluna', -2000)] },                                                                          // conversa já fechou sozinha
  };
  const r = tempos(conv, t0 - 7 * 86400e3, t0);
  assert.strictEqual(r.n, 3);
  assert.strictEqual(r.medianaSeg, 120);
  assert.strictEqual(r.sofia.n, 2);
  assert.strictEqual(r.equipe.n, 1);
  assert.strictEqual(r.equipe.medianaSeg, 1800);
  assert.strictEqual(r.ate5minPct, 66.7);
  const esp = esperando(conv, { agora: t0, minMin: 15, sessaoMs: 12 * 3600e3, encerrada: (k) => k === 'f' });
  assert.deepStrictEqual(esp.map(x => x.chave), ['c']);
  assert.strictEqual(esp[0].min, 80, 'conta da PRIMEIRA mensagem sem resposta, não da última');
  assert.strictEqual(fmtEspera(42), '42 s');
  assert.strictEqual(fmtEspera(1800), '30 min');
  assert.strictEqual(fmtEspera(7800), '2 h 10 min');
});

test('custo de aquisição: anúncios + IA, e não divide por zero', () => {
  const amb = ambienteIsolado();
  try {
    const m = amb.req('metas');
    const r = m.custoAquisicao({ anuncios: 1800, ia: 200, leads: 80, agendaram: 40, novas: 10 });
    assert.strictEqual(r.total, 2000);
    assert.strictEqual(r.porLead, 25);
    assert.strictEqual(r.porAgendamento, 50);
    assert.strictEqual(r.porMatricula, 200);
    const semAnuncio = m.custoAquisicao({ anuncios: null, ia: 200, leads: 80, agendaram: 0, novas: null });
    assert.strictEqual(semAnuncio.anuncios, null);
    assert.strictEqual(semAnuncio.porLead, 2.5);
    assert.strictEqual(semAnuncio.porAgendamento, null);
    assert.strictEqual(semAnuncio.porMatricula, null);
    // o investimento é do mês: não passa para o seguinte, e não apaga as metas
    m.salvarMetas('2026-11', { ativas: '220' });
    m.salvarInvestimento('2026-11', '1.800,00');
    assert.strictEqual(m.investimentoDoMes('2026-11'), 1800);
    assert.strictEqual(m.investimentoDoMes('2026-12'), null);
    assert.deepStrictEqual(m.metasDoMes('2026-11').valores, { ativas: 220 });
    m.salvarMetas('2026-11', { ativas: '230' });
    assert.strictEqual(m.investimentoDoMes('2026-11'), 1800, 'salvar metas não apaga o investimento');
    m.salvarInvestimento('2026-11', '');
    assert.strictEqual(m.investimentoDoMes('2026-11'), null);
  } finally { amb.limpar(); }
});
