require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const { validar, normalizarTelefone } = require('../src/validacao');

const COMPLETO = {
  hospital: 'h1', data: '2026-08-24', hora: '08:40',
  nome: 'Maria Aparecida de Souza', nascimento: '1962-03-12',
  telefone: '(62) 99123-4567', tipo: 'Segunda opinião',
  pagamento: 'Convênio — Unimed', consentimento: true,
};

test('formulário completo passa e sai normalizado', () => {
  const { ok, dados } = validar(COMPLETO);
  assert.equal(ok, true);
  assert.equal(dados.telefone, '5562991234567');
});

test('telefone aceita as formas que a pessoa realmente digita', () => {
  assert.equal(normalizarTelefone('(62) 99123-4567'), '5562991234567');
  assert.equal(normalizarTelefone('62991234567'), '5562991234567');
  assert.equal(normalizarTelefone('5562991234567'), '5562991234567');
  assert.equal(normalizarTelefone('6232251234'), '556232251234');   // fixo
  assert.equal(normalizarTelefone('991234567'), null);              // sem DDD
  assert.equal(normalizarTelefone('abc'), null);
});

test('sem consentimento não agenda', () => {
  const { ok, erros } = validar({ ...COMPLETO, consentimento: false });
  assert.equal(ok, false);
  assert.ok(erros.consentimento);
});

test('campo obrigatório em branco vira erro nomeado', () => {
  const { ok, erros } = validar({ ...COMPLETO, nome: '', hora: '' });
  assert.equal(ok, false);
  assert.ok(erros.nome && erros.hora);
});

test('só primeiro nome não passa', () => {
  assert.equal(validar({ ...COMPLETO, nome: 'Maria' }).ok, false);
});

test('tipo de consulta fora da lista é recusado', () => {
  assert.equal(validar({ ...COMPLETO, tipo: 'Cirurgia plástica' }).ok, false);
});

test('texto gigante é cortado, não derruba o servidor', () => {
  const { dados } = validar({ ...COMPLETO, motivo: 'x'.repeat(5000) });
  assert.equal(dados.motivo.length, 1000);
});
