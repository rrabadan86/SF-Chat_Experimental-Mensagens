// Fórmulas dos indicadores (auditoria de 11/2026): cada teste trava uma conta que
// já esteve errada e levava a uma leitura errada do negócio.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, DIA } = require('../ajuda');

const diaSP = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const meioDia = (iso) => Date.parse(iso + 'T12:00:00-03:00');

test('recebimentos: previsto, recebido, em atraso e cartão a cair não se misturam', () => {
  const { resumir } = require('../../src/financeiro-resumo');
  const r = resumir([
    { valor: 500, pago: 500, venc: '2026-11-05', sit: 'pago' },
    { valor: 300, pago: 280, venc: '2026-11-10', sit: 'pago' },                  // pago com desconto
    { valor: 400, pago: null, venc: '2026-11-12', sit: 'vencido' },              // atraso de verdade
    { valor: 250, pago: null, venc: '2026-11-15', sit: 'vencido', prov: true },  // cartão: a operadora ainda repassa
    { valor: 600, pago: null, venc: '2026-11-28', sit: 'a receber' },
    { valor: 200, pago: 200, venc: '2026-11-30', sit: 'pago' },                  // pagou adiantado
  ], '2026-11-20');
  assert.strictEqual(r.previsto, 2250);
  assert.strictEqual(r.recebido, 980);
  assert.strictEqual(r.atraso, 400);
  assert.strictEqual(r.aCair, 250);
  assert.strictEqual(r.aVencer, 600);
  assert.strictEqual(r.recebido + r.atraso + r.aCair + r.aVencer, 2230, 'só difere do previsto pelo desconto de R$ 20');
  // inadimplência = atraso ÷ o que já venceu (500 + 300 + 400); adiantado e cartão ficam fora
  assert.strictEqual(r.inadPct, 33.3);
  assert.strictEqual(resumir([], '2026-11-20').inadPct, null);
});

test('alunas ativas: mês em andamento se compara com o outro mês nos MESMOS dias', () => {
  const { serie, periodos, mesAteDia } = require('../../src/ativas-dados');
  // outubro inteiro (31 dias) + novembro até o dia 20: 1 saída por dia nos dois
  const n = 31 + 20, ativas = [], sairam = [], entraram = [], novas = [];
  let a = 300;
  for (let i = 0; i < n; i++) { a -= 1; ativas.push(a); sairam.push(1); entraram.push(0); novas.push(0); }
  const ser = serie({ inicio: '2026-10-01', ativas, entraram, novas, sairam });
  const meses = periodos(ser, 'mes');
  assert.strictEqual(meses[0].s, 31);   // mês cheio
  assert.strictEqual(meses[1].s, 20);   // mês parcial: comparar 20 × 31 pareceria melhora
  const out = mesAteDia(ser, '2026-10', 20), nov = mesAteDia(ser, '2026-11', 20);
  assert.strictEqual(out.s, 20);
  assert.strictEqual(nov.s, 20);
  assert.strictEqual(out.ini, 300);
  assert.strictEqual(nov.ini, meses[0].fim, 'o início do mês é o fechamento do anterior');
  assert.strictEqual(out.ate, '2026-10-20');
});

test('alunas ativas: quem venceu dentro da tolerância aparece como "ainda pode renovar"', () => {
  const { emRenovacao } = require('../../src/ativas-dados');
  const pessoas = {
    1: { n: 'Ativa', iv: [['2026-01-01', '2026-12-31']] },
    2: { n: 'Venceu ontem', iv: [['2026-01-01', '2026-11-19']] },
    3: { n: 'Venceu há 8 dias', iv: [['2026-01-01', '2026-11-12']] },   // ainda junta se o contrato novo começar hoje
    4: { n: 'Venceu há 9 dias', iv: [['2026-01-01', '2026-11-11']] },   // já é saída definitiva
    5: { n: 'Renovou na fila', iv: [['2026-01-01', '2026-11-18']], fq: ['Anual', '2026-11-22'] },
    6: { n: 'Sem contrato', iv: [] },
  };
  const r = emRenovacao(pessoas, '2026-11-20', 7);
  assert.deepStrictEqual(r.map(x => x.id).sort(), ['2', '3', '5']);
  assert.strictEqual(r.find(x => x.id === '2').saiu, '2026-11-20');
  assert.deepStrictEqual(r.find(x => x.id === '5').fila, ['Anual', '2026-11-22']);
});

test('funil: comparecimento, conversas e agendamento contam pelo período certo', () => {
  const amb = ambienteIsolado();
  try {
    const agora = Date.now(), hoje = diaSP(agora);
    const d = (n) => meioDia(diaSP(agora - n * DIA));       // meio-dia de n dias atrás
    const tel = (i) => '55629811100' + String(i).padStart(2, '0');
    const ag = (i, em, canal) => JSON.stringify({ chave: tel(i), tag: 'FX - 3. Agendou', motivo: 'agendou', acao: 'add', em, canal });
    amb.gravarSofia('sofia-tag-log.jsonl', [
      ag(1, d(2), 'sofia'),          // fez a aula
      ag(2, d(2), 'sofia'),          // faltou
      ag(3, d(1), 'sofia'),          // aula ainda vai acontecer
      ag(4, d(1), 'formulario'),     // aula ainda vai acontecer
      ag(5, d(20), 'sofia'),         // agendou há 20 dias…
      ag(5, d(3), 'sofia'),          // …e remarcou nesta semana
    ].join('\n') + '\n');
    const msg = (autor, em) => ({ autor, texto: 'oi', em });
    amb.gravarSofia('sofia-conversas.json', {
      [tel(1)]: { nome: 'Ana', ultimaEm: d(2), msgs: [msg('aluna', d(2))] },
      [tel(2)]: { nome: 'Bia', ultimaEm: d(2), msgs: [msg('aluna', d(2))] },
      [tel(3)]: { nome: 'Carla', ultimaEm: d(1), msgs: [msg('aluna', d(1))] },
      [tel(5)]: { nome: 'Eva', ultimaEm: d(3), msgs: [msg('aluna', d(20)), msg('aluna', d(3))] },
      // escreveu há 20 dias; a SoFIA mandou follow-up ontem — NÃO conversou nesta semana
      [tel(6)]: { nome: 'Fê', ultimaEm: d(1), msgs: [msg('aluna', d(20)), msg('sofia', d(1))] },
      // escreveu nesta semana e não agendou
      [tel(7)]: { nome: 'Gi', ultimaEm: d(2), msgs: [msg('aluna', d(2))] },
    });
    amb.gravarSofia('sofia-historico.json', {});
    const cont = {};
    for (const [i, nome, tags] of [[1, 'Ana', ['FX - 5. Fez Aula Experimental']], [2, 'Bia', ['FX - 2. Encerrado com Agendamento sem Presença']], [3, 'Carla', []], [4, 'Duda', []], [5, 'Eva', []], [6, 'Fê', []], [7, 'Gi', []]]) cont[tel(i)] = { tel: tel(i), nome, tags };
    amb.gravarData('contatos.json', cont);
    const ind = amb.req('painel-indicadores');
    const semana = ind.paginaSofiaFunil({ per: '7', canal: 'sofia', _numeros: true });
    // agendaram pela SoFIA nesta semana: 1, 2, 3 e 5 (a remarcação)
    assert.strictEqual(semana.agendaram, 4);
    // conversaram: quem ESCREVEU na semana (1, 2, 3, 5, 7) — a Fê só recebeu follow-up
    assert.strictEqual(semana.conversaram, 5);
    assert.ok(semana.agendaram <= semana.conversaram, 'a etapa de baixo cabe na de cima');
    // comparecimento = fez ÷ (fez + faltou) = 1 ÷ 2; quem ainda vai fazer não entra
    assert.strictEqual(semana.fez, 1);
    assert.strictEqual(semana.faltou, 1);
    assert.strictEqual(semana.aguardando + semana.semRegistro, 2);
    assert.strictEqual(semana.comparecimentoPct, 50);
    // o agendamento de 20 dias atrás continua contando no período dele, mesmo remarcado depois
    const antigo = ind.paginaSofiaFunil({ de: diaSP(agora - 22 * DIA), ate: diaSP(agora - 18 * DIA), canal: 'sofia', _numeros: true });
    assert.strictEqual(antigo.agendaram, 1);
    assert.strictEqual(antigo.conversaram, 2, 'Eva e Fê escreveram naquele período');
    assert.ok(hoje);
  } finally { amb.limpar(); }
});
