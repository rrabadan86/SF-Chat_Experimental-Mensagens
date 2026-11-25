require('./ambiente');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

/* Google de mentira no nível da biblioteca, para exercitar testarAcesso() de
   verdade — inclusive os caminhos de erro, que são o que o médico mais vê. */
const chamadas = [];
const respostas = {
  calendarsGet: async () => ({ data: { summary: 'Consultas — INGOH' } }),
  eventsInsert: async () => ({ data: { id: 'evt-teste' } }),
  eventsDelete: async () => ({}),
};

function erroGoogle(codigo, mensagem) {
  const e = new Error(mensagem || 'erro');
  e.code = codigo;
  return e;
}

const googleFalso = {
  auth: { GoogleAuth: class { async getClient() { return { email: 'marcacao@x.iam.gserviceaccount.com' }; } } },
  calendar: () => ({
    calendars: { get: (a) => { chamadas.push(['calendars.get', a]); return respostas.calendarsGet(a); } },
    events: {
      insert: (a) => { chamadas.push(['events.insert', a]); return respostas.eventsInsert(a); },
      delete: (a) => { chamadas.push(['events.delete', a]); return respostas.eventsDelete(a); },
    },
  }),
};
const caminho = require.resolve('googleapis');
require.cache[caminho] = {
  id: caminho, filename: caminho, loaded: true, children: [], paths: [],
  exports: { google: googleFalso },
};

process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: 'k' });
const agenda = require('../src/google-agenda');

beforeEach(() => {
  chamadas.length = 0;
  respostas.calendarsGet = async () => ({ data: { summary: 'Consultas — INGOH' } });
  respostas.eventsInsert = async () => ({ data: { id: 'evt-teste' } });
  respostas.eventsDelete = async () => ({});
});

test('agenda compartilhada com permissão de escrita passa', async () => {
  const r = await agenda.testarAcesso('c1871a@group.calendar.google.com');
  assert.equal(r.ok, true);
  assert.equal(r.nome, 'Consultas — INGOH');
  assert.match(r.mensagem, /Permissão correta/);
});

test('o teste cria e apaga um evento — não deixa sujeira na agenda', async () => {
  await agenda.testarAcesso('c1871a@group.calendar.google.com');
  const nomes = chamadas.map((c) => c[0]);
  assert.deepEqual(nomes, ['calendars.get', 'events.insert', 'events.delete']);

  const inserido = chamadas.find((c) => c[0] === 'events.insert')[1].requestBody;
  assert.match(inserido.summary, /Teste de conexão/);
  assert.equal(inserido.transparency, 'transparent');   // não ocupa horário
  const apagado = chamadas.find((c) => c[0] === 'events.delete')[1];
  assert.equal(apagado.eventId, 'evt-teste');
});

test('agenda não compartilhada explica o que fazer', async () => {
  respostas.calendarsGet = async () => { throw erroGoogle(404); };
  const r = await agenda.testarAcesso('sumida@group.calendar.google.com');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'nao_compartilhada');
  assert.match(r.mensagem, /compartilhada com a conta de serviço/);
});

test('permissão só de leitura é detectada na hora de escrever', async () => {
  respostas.eventsInsert = async () => { throw erroGoogle(403); };
  const r = await agenda.testarAcesso('so-leitura@group.calendar.google.com');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'permissao');
  assert.match(r.mensagem, /Fazer alterações nos eventos/);
});

test('se o evento de teste não puder ser apagado, avisa em vez de mentir', async () => {
  respostas.eventsDelete = async () => { throw erroGoogle(500); };
  const r = await agenda.testarAcesso('c1871a@group.calendar.google.com');
  assert.equal(r.ok, true);              // a escrita funcionou, que é o que importa
  assert.equal(r.limpezaFalhou, true);
  assert.match(r.mensagem, /apague à mão/i);
});

test('ID em branco nem chega ao Google', async () => {
  const r = await agenda.testarAcesso('   ');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'vazio');
  assert.equal(chamadas.length, 0);
});
