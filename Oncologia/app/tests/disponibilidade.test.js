require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const disp = require('../src/disponibilidade');

const H1 = { id: 'h1', dias: [1, 3], inicio: '08:00', fim: '12:00', duracaoMin: 40, intervaloMin: 0, antecedenciaMinHoras: 24, janelaDias: 60 };
const H2 = { id: 'h2', dias: [2, 4], inicio: '14:00', fim: '18:00', duracaoMin: 40, intervaloMin: 0, antecedenciaMinHoras: 24, janelaDias: 60 };
const LONGE = new Date('2026-08-01T12:00:00-03:00');   // bem antes das datas usadas

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

test('horário ocupado no Google some da lista', () => {
  const ocupados = [{ inicio: '2026-08-24T09:20:00-03:00', fim: '2026-08-24T10:00:00-03:00' }];
  const slots = disp.slotsLivres(H1, '2026-08-24', ocupados, LONGE);
  assert.equal(slots.find((s) => s.inicio === '09:20').livre, false);
  assert.equal(slots.find((s) => s.inicio === '08:40').livre, true);
});

test('compromisso que cobre só parte do slot também bloqueia', () => {
  const ocupados = [{ inicio: '2026-08-24T09:30:00-03:00', fim: '2026-08-24T09:35:00-03:00' }];
  const slots = disp.slotsLivres(H1, '2026-08-24', ocupados, LONGE);
  assert.equal(slots.find((s) => s.inicio === '09:20').livre, false);
});

test('compromisso encostado no slot NÃO bloqueia (fim = início)', () => {
  const ocupados = [{ inicio: '2026-08-24T08:40:00-03:00', fim: '2026-08-24T09:20:00-03:00' }];
  const slots = disp.slotsLivres(H1, '2026-08-24', ocupados, LONGE);
  assert.equal(slots.find((s) => s.inicio === '09:20').livre, true);
  assert.equal(slots.find((s) => s.inicio === '08:40').livre, false);
});

test('o médico é um só: ocupação do Hospital 1 bloqueia o Hospital 2', () => {
  // 2026-08-25 é terça (dia do H2); o compromisso veio da agenda do H1
  const ocupados = [{ inicio: '2026-08-25T14:00:00-03:00', fim: '2026-08-25T15:00:00-03:00' }];
  const slots = disp.slotsLivres(H2, '2026-08-25', ocupados, LONGE);
  assert.equal(slots.find((s) => s.inicio === '14:00').livre, false);
  assert.equal(slots.find((s) => s.inicio === '14:40').livre, false);
  assert.equal(slots.find((s) => s.inicio === '15:20').livre, true);
});

test('antecedência mínima derruba o que está perto demais', () => {
  const agora = new Date('2026-08-24T07:00:00-03:00');   // mesmo dia, 1h antes
  const slots = disp.slotsLivres(H1, '2026-08-24', [], agora);
  assert.ok(slots.every((s) => !s.livre));
  assert.equal(slots[0].motivo, 'antecedencia');
});

test('próximos dias pulam os dias sem ambulatório', () => {
  assert.deepEqual(
    disp.proximosDias(H1, '2026-08-24', 4),
    ['2026-08-24', '2026-08-26', '2026-08-31', '2026-09-02']
  );
});

test('horarioEstaLivre é o mesmo critério da grade', () => {
  const ocupados = [{ inicio: '2026-08-24T08:00:00-03:00', fim: '2026-08-24T08:40:00-03:00' }];
  assert.equal(disp.horarioEstaLivre(H1, '2026-08-24', '08:00', ocupados, LONGE), false);
  assert.equal(disp.horarioEstaLivre(H1, '2026-08-24', '08:40', ocupados, LONGE), true);
  assert.equal(disp.horarioEstaLivre(H1, '2026-08-24', '13:00', ocupados, LONGE), false); // fora da grade
});
