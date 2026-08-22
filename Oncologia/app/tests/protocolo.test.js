require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('../src/protocolo');

test('gera protocolo no formato combinado', () => {
  for (let i = 0; i < 50; i++) assert.match(p.gerar(2026), /^PA-2026-\d{4}$/);
});

test('acha o protocolo no meio de qualquer texto', () => {
  assert.equal(p.extrair('confirmar pa-2026-4817 por favor'), 'PA-2026-4817');
  assert.equal(p.extrair('bom dia!'), null);
});

test('entende a resposta da recepcionista em maiúscula ou minúscula', () => {
  assert.deepEqual(p.interpretar('CONFIRMAR PA-2026-4817'), { comando: 'CONFIRMAR', protocolo: 'PA-2026-4817' });
  assert.deepEqual(p.interpretar('remarcar PA-2026-4817'), { comando: 'REMARCAR', protocolo: 'PA-2026-4817' });
  assert.deepEqual(p.interpretar('pode cancelar o pa-2026-0001'), { comando: 'CANCELAR', protocolo: 'PA-2026-0001' });
});

test('protocolo sem comando devolve o número e comando nulo', () => {
  assert.deepEqual(p.interpretar('PA-2026-4817?'), { comando: null, protocolo: 'PA-2026-4817' });
});

test('conversa normal da recepção não vira comando', () => {
  assert.equal(p.interpretar('confirmar com a paciente amanhã'), null);
  assert.equal(p.interpretar('bom dia, tudo bem?'), null);
});
