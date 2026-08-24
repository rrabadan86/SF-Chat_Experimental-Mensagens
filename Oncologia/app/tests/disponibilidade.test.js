require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const disp = require('../src/disponibilidade');

// seg/qua de manhã
const H1 = {
  id: 'h1', duracaoMin: 40, intervaloMin: 0, antecedenciaMinHoras: 24, janelaDias: 60,
  vagasPorHorario: 1,
  expediente: [{ dias: [1, 3], inicio: '08:00', fim: '12:00' }],
};
// ter/qui à tarde
const H2 = {
  id: 'h2', duracaoMin: 40, intervaloMin: 0, antecedenciaMinHoras: 24, janelaDias: 60,
  vagasPorHorario: 1,
  expediente: [{ dias: [2, 4], inicio: '14:00', fim: '18:00' }],
};
// o caso real: seg/ter/qua de manhã, qui à tarde, sexta não atende
const MISTO = {
  id: 'misto', duracaoMin: 40, intervaloMin: 0, antecedenciaMinHoras: 24, janelaDias: 60,
  vagasPorHorario: 1,
  expediente: [
    { dias: [1, 2, 3], inicio: '07:30', fim: '12:00' },
    { dias: [4], inicio: '14:00', fim: '17:00' },
  ],
};
const LONGE = new Date('2026-08-01T12:00:00-03:00');

test('grade só existe nos dias de ambulatório do hospital', () => {
  assert.equal(disp.gradeDoDia(H1, '2026-08-24').length, 6);  // segunda
  assert.equal(disp.gradeDoDia(H1, '2026-08-25').length, 0);  // terça não é do H1
  assert.equal(disp.gradeDoDia(H2, '2026-08-25').length, 6);
});

test('a última consulta cabe inteira dentro do expediente', () => {
  const grade = disp.gradeDoDia(H1, '2026-08-24');
  assert.equal(grade[0].inicio, '08:00');
  assert.equal(grade[grade.length - 1].fim, '12:00');
  assert.ok(grade.every((s) => s.fim <= '12:00'));
});

/* ---------- faixas: horário diferente em cada dia ---------- */

test('cada dia usa o horário da sua faixa', () => {
  // segunda (07:30–12:00) tem 6 consultas de 40 min
  const segunda = disp.gradeDoDia(MISTO, '2026-08-24');
  assert.equal(segunda[0].inicio, '07:30');
  assert.equal(segunda[segunda.length - 1].fim, '11:30');   // 10:50 + 40, o próximo passaria das 12h

  // quinta é outra faixa, à tarde
  const quinta = disp.gradeDoDia(MISTO, '2026-08-27');
  assert.equal(quinta[0].inicio, '14:00');
  assert.equal(quinta[quinta.length - 1].fim, '16:40');
});

test('dia fora de todas as faixas não tem grade', () => {
  assert.equal(disp.gradeDoDia(MISTO, '2026-08-28').length, 0);   // sexta
  assert.equal(disp.gradeDoDia(MISTO, '2026-08-29').length, 0);   // sábado
});

test('dia partido soma as duas faixas, em ordem', () => {
  const partido = {
    ...H1, expediente: [
      { dias: [1], inicio: '14:00', fim: '16:00' },     // tarde declarada primeiro
      { dias: [1], inicio: '08:00', fim: '10:00' },     // manhã depois
    ],
  };
  const grade = disp.gradeDoDia(partido, '2026-08-24');
  assert.deepEqual(grade.map((s) => s.inicio),
    ['08:00', '08:40', '09:20', '14:00', '14:40', '15:20']);
});

test('próximos dias consideram a união das faixas', () => {
  assert.deepEqual(
    disp.proximosDias(MISTO, '2026-08-24', 5),
    ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-31']
  );
  assert.deepEqual(disp.diasAtendidos(MISTO), [1, 2, 3, 4]);
});

/* ---------- ocupação ---------- */

test('horário ocupado no Google some da lista', () => {
  const consultas = [{ inicio: '2026-08-24T09:20:00-03:00', fim: '2026-08-24T10:00:00-03:00' }];
  const slots = disp.slotsLivres(H1, '2026-08-24', { consultas }, LONGE);
  assert.equal(slots.find((s) => s.inicio === '09:20').livre, false);
  assert.equal(slots.find((s) => s.inicio === '08:40').livre, true);
});

test('compromisso que cobre só parte do slot também bloqueia', () => {
  const bloqueios = [{ inicio: '2026-08-24T09:30:00-03:00', fim: '2026-08-24T09:35:00-03:00' }];
  const slots = disp.slotsLivres(H1, '2026-08-24', { bloqueios }, LONGE);
  assert.equal(slots.find((s) => s.inicio === '09:20').livre, false);
});

test('compromisso encostado no slot NÃO bloqueia (fim = início)', () => {
  const bloqueios = [{ inicio: '2026-08-24T08:40:00-03:00', fim: '2026-08-24T09:20:00-03:00' }];
  const slots = disp.slotsLivres(H1, '2026-08-24', { bloqueios }, LONGE);
  assert.equal(slots.find((s) => s.inicio === '09:20').livre, true);
  assert.equal(slots.find((s) => s.inicio === '08:40').livre, false);
});

test('o médico é um só: ocupação do Hospital 1 bloqueia o Hospital 2', () => {
  const bloqueios = [{ inicio: '2026-08-25T14:00:00-03:00', fim: '2026-08-25T15:00:00-03:00' }];
  const slots = disp.slotsLivres(H2, '2026-08-25', { bloqueios }, LONGE);
  assert.equal(slots.find((s) => s.inicio === '14:00').livre, false);
  assert.equal(slots.find((s) => s.inicio === '14:40').livre, false);
  assert.equal(slots.find((s) => s.inicio === '15:20').livre, true);
});

test('antecedência mínima derruba o que está perto demais', () => {
  const agora = new Date('2026-08-24T07:00:00-03:00');
  const slots = disp.slotsLivres(H1, '2026-08-24', {}, agora);
  assert.ok(slots.every((s) => !s.livre));
  assert.equal(slots[0].motivo, 'antecedencia');
});

/* ---------- duas consultas no mesmo horário ---------- */

const DOIS = { ...H1, vagasPorHorario: 2 };

test('com 2 vagas, uma consulta marcada deixa o horário ainda livre', () => {
  const consultas = [{ inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' }];
  const slot = disp.slotsLivres(DOIS, '2026-08-24', { consultas }, LONGE)
    .find((s) => s.inicio === '08:00');
  assert.equal(slot.livre, true);
  assert.equal(slot.ocupadas, 1);
  assert.equal(slot.vagas, 2);
});

test('com 2 vagas, a segunda consulta fecha o horário', () => {
  const consultas = [
    { inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' },
    { inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' },
  ];
  const slot = disp.slotsLivres(DOIS, '2026-08-24', { consultas }, LONGE)
    .find((s) => s.inicio === '08:00');
  assert.equal(slot.livre, false);
  assert.equal(slot.motivo, 'lotado');
  assert.equal(slot.ocupadas, 2);
});

test('bloqueio fecha o horário mesmo sobrando vaga', () => {
  // o médico está em outro hospital: não adianta ter 2 vagas aqui
  const bloqueios = [{ inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' }];
  const slot = disp.slotsLivres(DOIS, '2026-08-24', { bloqueios }, LONGE)
    .find((s) => s.inicio === '08:00');
  assert.equal(slot.livre, false);
  assert.equal(slot.motivo, 'bloqueado');
  assert.equal(slot.ocupadas, 0);
});

test('vagas não vazam para o horário vizinho', () => {
  const consultas = [{ inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' }];
  const slots = disp.slotsLivres(DOIS, '2026-08-24', { consultas }, LONGE);
  assert.equal(slots.find((s) => s.inicio === '08:40').ocupadas, 0);
});

test('vagasPorHorario ausente ou zero vale como 1', () => {
  const consultas = [{ inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' }];
  for (const vagas of [undefined, 0, null]) {
    const h = { ...H1, vagasPorHorario: vagas };
    const slot = disp.slotsLivres(h, '2026-08-24', { consultas }, LONGE).find((s) => s.inicio === '08:00');
    assert.equal(slot.livre, false, `vagas=${vagas}`);
  }
});

test('horarioEstaLivre é o mesmo critério da grade', () => {
  const consultas = [{ inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' }];
  assert.equal(disp.horarioEstaLivre(H1, '2026-08-24', '08:00', { consultas }, LONGE), false);
  assert.equal(disp.horarioEstaLivre(DOIS, '2026-08-24', '08:00', { consultas }, LONGE), true);
  assert.equal(disp.horarioEstaLivre(H1, '2026-08-24', '08:40', { consultas }, LONGE), true);
  assert.equal(disp.horarioEstaLivre(H1, '2026-08-24', '13:00', { consultas }, LONGE), false);
});
