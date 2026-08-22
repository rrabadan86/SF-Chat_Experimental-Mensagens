require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../src/mensagens');

const HOSPITAL = { id: 'h1', nome: 'Hospital 1', agenda: 'Agenda A', endereco: 'a definir' };
const AG = {
  protocolo: 'PA-2026-4817', data: '2026-08-24', hora: '08:40',
  nome: 'Maria Aparecida de Souza', nascimento: '1962-03-12', telefone: '5562991234567',
  tipo: 'Segunda opinião', pagamento: 'Convênio — Unimed', carteirinha: '0123',
  motivo: 'Nódulo em mama esquerda.', encaminhamento: 'Dra. Helena Prado',
};

test('mensagem da recepção traz tudo que ela precisa para ligar', () => {
  const texto = m.paraRecepcao(AG, HOSPITAL, '2026-08-22');
  for (const trecho of ['PA-2026-4817', 'Hospital 1', 'seg, 24/08', '08:40',
    'Maria Aparecida de Souza', '64 anos', '5562991234567', 'Segunda opinião',
    'carteirinha 0123', 'Dra. Helena Prado', 'CONFIRMAR PA-2026-4817']) {
    assert.ok(texto.includes(trecho), `faltou "${trecho}" na mensagem`);
  }
});

test('campos opcionais vazios não deixam linha órfã', () => {
  const texto = m.paraRecepcao({ ...AG, encaminhamento: '', motivo: '', carteirinha: '' }, HOSPITAL, '2026-08-22');
  assert.ok(!texto.includes('Encaminhado por:'));
  assert.ok(!texto.includes('Motivo:'));
  assert.ok(!texto.includes('carteirinha'));
});

test('confirmação do paciente é escrita para o paciente, não para o sistema', () => {
  const texto = m.confirmacaoPaciente(AG, HOSPITAL, { nome: 'Dr. Marcelo Andrade' });
  assert.ok(texto.startsWith('Olá, Maria!'));
  assert.ok(texto.includes('confirmada'));
  assert.ok(texto.includes('seg, 24 de agosto de 2026'));
  assert.ok(!texto.includes('PA-2026'));           // protocolo é assunto interno
  assert.ok(!texto.includes('a definir'));         // placeholder não vaza
});

test('primeiro nome lida com espaço sobrando', () => {
  assert.equal(m.primeiroNome('  Maria  Aparecida '), 'Maria');
  assert.equal(m.primeiroNome(''), '');
});
