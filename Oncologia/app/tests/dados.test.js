require('./ambiente');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const dados = require('../src/dados');

const BASE = {
  nome: 'Hospital Santa Clara',
  calendarId: 'c_abc@group.calendar.google.com',
  expediente: [{ dias: [1, 3], inicio: '08:00', fim: '12:00' }],
  duracaoMin: 40, intervaloMin: 0, vagasPorHorario: 1,
  antecedenciaMinHoras: 24, janelaDias: 60,
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

test('recusa faixa sem nenhum dia', () => {
  const bruto = { ...BASE, expediente: [{ dias: [], inicio: '08:00', fim: '12:00' }] };
  assert.ok(dados.validarHospital(bruto, { existentes: [] }).erros['expediente.0.dias']);
});

test('recusa local sem nenhuma faixa', () => {
  assert.ok(dados.validarHospital({ ...BASE, expediente: [] }, { existentes: [] }).erros.expediente);
});

test('recusa fim antes do início', () => {
  const bruto = { ...BASE, expediente: [{ dias: [1], inicio: '14:00', fim: '10:00' }] };
  assert.ok(dados.validarHospital(bruto, { existentes: [] }).erros['expediente.0.fim']);
});

test('recusa faixa que não comporta uma consulta inteira', () => {
  const bruto = { ...BASE, expediente: [{ dias: [1], inicio: '08:00', fim: '08:30' }], duracaoMin: 40 };
  const { erros } = dados.validarHospital(bruto, { existentes: [] });
  assert.match(erros['expediente.0.fim'], /não cabe/i);
});

test('recusa dia da semana inventado', () => {
  const bruto = { ...BASE, expediente: [{ dias: [1, 9, 3], inicio: '08:00', fim: '12:00' }] };
  const { hospital } = dados.validarHospital(bruto, { existentes: [] });
  assert.deepEqual(hospital.expediente[0].dias, [1, 3]);
});

test('recusa duas faixas que se sobrepõem no mesmo dia', () => {
  const bruto = { ...BASE, expediente: [
    { dias: [1, 2], inicio: '08:00', fim: '12:00' },
    { dias: [2], inicio: '11:00', fim: '15:00' },     // choca na terça
  ] };
  const { ok, erros } = dados.validarHospital(bruto, { existentes: [] });
  assert.equal(ok, false);
  assert.match(erros['expediente.1.inicio'], /sobrep/i);
});

test('aceita duas faixas no mesmo dia sem sobreposição (manhã e tarde)', () => {
  const bruto = { ...BASE, expediente: [
    { dias: [1], inicio: '08:00', fim: '12:00' },
    { dias: [1], inicio: '14:00', fim: '18:00' },
  ] };
  assert.equal(dados.validarHospital(bruto, { existentes: [] }).ok, true);
});

test('recusa vagas por horário fora da faixa', () => {
  for (const v of [0, -1, 11]) {
    assert.ok(dados.validarHospital({ ...BASE, vagasPorHorario: v }, { existentes: [] }).erros.vagasPorHorario, String(v));
  }
  assert.equal(dados.validarHospital({ ...BASE, vagasPorHorario: 2 }, { existentes: [] }).ok, true);
});

test('formato antigo (dias/inicio/fim) vira uma faixa ao ser lido', () => {
  const antigo = { id: 'x', nome: 'Antigo', calendarId: 'a@g.com', dias: [1, 3], inicio: '08:00', fim: '12:00', duracaoMin: 40 };
  const migrado = dados.migrarHospital(antigo);
  assert.deepEqual(migrado.expediente, [{ dias: [1, 3], inicio: '08:00', fim: '12:00' }]);
  assert.equal(migrado.vagasPorHorario, 1);
  assert.equal(migrado.dias, undefined);
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
