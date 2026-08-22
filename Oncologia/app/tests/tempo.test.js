require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const t = require('../src/tempo');

test('monta data RFC3339 com o fuso de Brasília', () => {
  assert.equal(t.rfc3339('2026-08-25', '08:00'), '2026-08-25T08:00:00-03:00');
});

test('dia da semana não escorrega por causa de fuso', () => {
  assert.equal(t.diaDaSemana('2026-08-25'), 2);  // terça
  assert.equal(t.diaDaSemana('2026-01-01'), 4);  // quinta
});

test('soma dias atravessando a virada do mês e do ano', () => {
  assert.equal(t.somarDias('2026-08-31', 1), '2026-09-01');
  assert.equal(t.somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(t.somarDias('2028-02-28', 1), '2028-02-29');
});

test('converte hora e minutos nos dois sentidos', () => {
  assert.equal(t.emMinutos('08:40'), 520);
  assert.equal(t.emHora(520), '08:40');
  assert.equal(t.emHora(t.emMinutos('14:00') + 40), '14:40');
});

test('idade só conta aniversário já passado', () => {
  assert.equal(t.idade('1962-03-12', '2026-08-22'), 64);
  assert.equal(t.idade('1962-12-12', '2026-08-22'), 63);
  assert.equal(t.idade('1962-08-22', '2026-08-22'), 64);
});

test('hoje respeita o fuso na virada da meia-noite', () => {
  // 03:30 UTC de dia 26 ainda é dia 25 em Brasília
  assert.equal(t.hoje(new Date('2026-08-26T02:30:00Z')), '2026-08-25');
  assert.equal(t.hoje(new Date('2026-08-26T04:30:00Z')), '2026-08-26');
});
