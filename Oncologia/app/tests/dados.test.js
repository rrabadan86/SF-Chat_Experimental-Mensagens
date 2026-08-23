require('./ambiente');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const dados = require('../src/dados');

const BASE = {
  nome: 'Hospital Santa Clara',
  calendarId: 'c_abc@group.calendar.google.com',
  dias: [1, 3], inicio: '08:00', fim: '12:00',
  duracaoMin: 40, intervaloMin: 0, antecedenciaMinHoras: 24, janelaDias: 60,
};

beforeEach(() => {
  fs.rmSync(process.env.DADOS_ARQUIVO, { force: true });
  dados.gravar(dados.semente());
});

test('primeira execução herda o que estava no .env', () => {
  fs.rmSync(process.env.DADOS_ARQUIVO, { force: true });
  const c = dados.ler();
  assert.equal(c.hospitais.length, 2);
  assert.equal(c.hospitais[0].calendarId, 'h1@group.calendar.google.com');
  assert.equal(c.hospitais[0].ativo, true);
  assert.equal(c.recepcao.whatsapp, '5562999998888');
});

test('grava e relê o que o painel salvou', () => {
  dados.alterar((c) => { c.medico.nome = 'Dra. Helena Prado'; });
  assert.equal(dados.ler().medico.nome, 'Dra. Helena Prado');
  assert.ok(dados.ler().atualizadoEm);
});

test('id novo sai do nome, sem acento e sem repetir', () => {
  assert.equal(dados.novoId('Hospital São Lucas', []), 'hospital-sao-lucas');
  assert.equal(dados.novoId('Hospital 1', [{ id: 'hospital-1' }]), 'hospital-1-2');
  assert.equal(dados.novoId('!!!', []), 'local');
});

test('hospital válido passa e sai normalizado', () => {
  const { ok, hospital } = dados.validarHospital(BASE, { existentes: [] });
  assert.equal(ok, true);
  assert.equal(hospital.id, 'hospital-santa-clara');
  assert.equal(hospital.ativo, true);
});

test('recusa agenda repetida em outro local', () => {
  const outro = { id: 'h1', calendarId: 'c_abc@group.calendar.google.com' };
  const { ok, erros } = dados.validarHospital(BASE, { existentes: [outro] });
  assert.equal(ok, false);
  assert.match(erros.calendarId, /já está sendo usada/);
});

test('recusa ID de agenda que não parece um', () => {
  const { erros } = dados.validarHospital({ ...BASE, calendarId: 'minha agenda' }, { existentes: [] });
  assert.ok(erros.calendarId);
});

test('recusa expediente sem nenhum dia', () => {
  assert.ok(dados.validarHospital({ ...BASE, dias: [] }, { existentes: [] }).erros.dias);
});

test('recusa fim antes do início', () => {
  const { erros } = dados.validarHospital({ ...BASE, inicio: '14:00', fim: '10:00' }, { existentes: [] });
  assert.ok(erros.fim);
});

test('recusa expediente que não comporta uma consulta inteira', () => {
  const { erros } = dados.validarHospital({ ...BASE, inicio: '08:00', fim: '08:30', duracaoMin: 40 }, { existentes: [] });
  assert.match(erros.duracaoMin, /não cabe|Não cabe/i);
});

test('recusa dia da semana inventado', () => {
  const { hospital } = dados.validarHospital({ ...BASE, dias: [1, 9, 3] }, { existentes: [] });
  assert.deepEqual(hospital.dias, [1, 3]);
});

test('whatsapp da recepção precisa do formato com DDI', () => {
  const bons = ['5562991234567', '556232251234'];
  const ruins = ['62991234567', '991234567', '', 'abc'];
  for (const zap of bons) {
    assert.equal(dados.validarGerais({ medico: { nome: 'X' }, recepcao: { whatsapp: zap } }).ok, true, zap);
  }
  for (const zap of ruins) {
    assert.equal(dados.validarGerais({ medico: { nome: 'X' }, recepcao: { whatsapp: zap } }).ok, false, zap);
  }
});

test('escrita é atômica: não sobra arquivo temporário', () => {
  dados.alterar((c) => { c.medico.crm = 'CRM-GO 12345'; });
  const pasta = require('node:path').dirname(process.env.DADOS_ARQUIVO);
  assert.equal(fs.readdirSync(pasta).filter((f) => f.endsWith('.tmp')).length, 0);
});
