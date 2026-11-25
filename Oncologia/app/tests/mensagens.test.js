require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../src/mensagens');
const t = require('../src/tempo');

const HOSPITAL = { id: 'h1', nome: 'Hospital 1', agenda: 'Agenda A', endereco: 'a definir' };
const AG = {
  protocolo: 'PA-2026-4817', data: '2026-08-24', hora: '08:40',
  nome: 'Maria Aparecida de Souza', nascimento: '1962-03-12', telefone: '5562991234567',
  tipo: 'Segunda opinião', pagamento: 'Convênio — Unimed', carteirinha: '0123',
  motivo: 'Nódulo em mama esquerda.', encaminhamento: 'Dra. Helena Prado',
};

test('mensagem da recepção traz tudo que ela precisa para ligar', () => {
  const texto = m.paraRecepcao(AG, HOSPITAL, '2026-08-22');
  for (const trecho of ['PA-2026-4817', 'Hospital 1', 'Segunda, 24 de agosto', '08:40',
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
  const texto = m.confirmacaoPaciente(AG, HOSPITAL, { nome: 'Dr. Felipe Oliveira' });
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

test('nascimento lido do evento volta legível, com a idade', () => {
  // a descrição do evento guarda dd/mm/aaaa; lido de volta como se fosse ISO,
  // virava "undefined/undefined/09/01/1986" e a idade sumia
  const texto = m.paraRecepcao(
    { ...AG, nascimento: t.deBrasileira('09/01/1986') },
    HOSPITAL, '2026-08-25'
  );
  assert.match(texto, /\*Nascimento:\* 09\/01\/1986 \(40 anos\)/);
  assert.ok(!texto.includes('undefined'));
});

test('a data da consulta abre a mensagem, em linha própria', () => {
  const texto = m.paraRecepcao({ ...AG, data: '2026-08-27', hora: '12:40' },
    HOSPITAL, '2026-08-25');
  const linhas = texto.split('\n');
  assert.match(linhas[2], /^🗓 \*Quinta, 27 de agosto · 12:40\*$/);
  assert.match(linhas[3], /^📍 /);
});

test('o ano só aparece quando não é o corrente', () => {
  const esteAno = m.paraRecepcao({ ...AG, data: '2026-08-27' }, HOSPITAL, '2026-08-25');
  assert.ok(!/de 2026 ·/.test(esteAno), 'sem ano na agenda do próprio ano');

  const outro = m.paraRecepcao({ ...AG, data: '2027-01-14' }, HOSPITAL, '2026-12-20');
  assert.match(outro, /14 de janeiro de 2027 ·/);
});
