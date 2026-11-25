require('./ambiente');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

/* whatsapp-web.js de mentira: o que interessa é como o número vira endereço. */
const registrados = new Set();
const consultados = [];
const clienteFalso = {
  async getNumberId(numero) {
    consultados.push(numero);
    return registrados.has(numero) ? { _serialized: `${numero}@c.us` } : null;
  },
  async sendMessage(destino, texto) { return { destino, texto }; },
  info: null,   // preenchido nos testes que precisam do número da sessão
};

const caminho = require.resolve('whatsapp-web.js');
require.cache[caminho] = {
  id: caminho, filename: caminho, loaded: true, children: [], paths: [],
  exports: { Client: class {}, LocalAuth: class {} },
};

process.env.WA_DRIVER = 'wwebjs';
const driver = require('../src/whatsapp/wwebjs');

driver._usarCliente(clienteFalso);

beforeEach(() => { registrados.clear(); consultados.length = 0; });

test('número registrado vira o endereço que o WhatsApp devolveu', async () => {
  registrados.add('5562981718205');
  const endereco = await driver.enderecoDe('5562981718205');
  assert.equal(endereco, '5562981718205@c.us');
});

test('linha antiga sem o nono dígito é encontrada na segunda tentativa', async () => {
  registrados.add('556281718205');                      // sem o 9
  const endereco = await driver.enderecoDe('5562981718205');
  assert.equal(endereco, '556281718205@c.us');
  assert.deepEqual(consultados, ['5562981718205', '556281718205']);
});

test('quem explica o número duvidoso é o verificar, não o envio', async () => {
  // enderecoDe não recusa mais: a consulta serve para acertar o endereço, não
  // para autorizar. Quem dá o veredito legível é o botão "Testar número".
  assert.equal(await driver.enderecoDe('5562900000000'), '5562900000000@c.us');

  const r = await driver.verificar('5562900000000');
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /dígito trocado|sem WhatsApp/);
});

test('número vazio nem consulta o WhatsApp', async () => {
  await assert.rejects(() => driver.enderecoDe('  '), /vazio/);
  assert.equal(consultados.length, 0);
});

test('a máscara do número é ignorada', async () => {
  registrados.add('5562981718205');
  assert.equal(await driver.enderecoDe('+55 (62) 98171-8205'), '5562981718205@c.us');
});

test('o próprio número da sessão não passa pelo getNumberId', async () => {
  // é o caso do consultório com um aparelho só: a sessão e o telefone da
  // recepção são a mesma linha. O getNumberId devolve nulo para o próprio
  // wid, e antes disso o envio morria com "não foi encontrado no WhatsApp".
  clienteFalso.info = { wid: { user: '5562981718205', _serialized: '5562981718205@c.us' } };
  assert.equal(await driver.enderecoDe('(62) 98171-8205'), '5562981718205@c.us');
  assert.deepEqual(consultados, []);
  clienteFalso.info = null;
});

test('a sessão é reconhecida mesmo se cadastrada sem o nono dígito', async () => {
  clienteFalso.info = { wid: { user: '5562981718205', _serialized: '5562981718205@c.us' } };
  assert.equal(await driver.enderecoDe('556281718205'), '5562981718205@c.us');
  assert.deepEqual(consultados, []);
  clienteFalso.info = null;
});

test('linha cadastrada sem o 9 é achada com o 9', async () => {
  registrados.add('5562981718205');                     // no WhatsApp, com o 9
  const endereco = await driver.enderecoDe('556281718205');   // cadastrada sem
  assert.equal(endereco, '5562981718205@c.us');
  assert.deepEqual(consultados, ['556281718205', '5562981718205']);
});

test('número de outra pessoa continua sendo consultado', async () => {
  clienteFalso.info = { wid: { user: '5562981718205', _serialized: '5562981718205@c.us' } };
  registrados.add('5562999998888');
  assert.equal(await driver.enderecoDe('5562999998888'), '5562999998888@c.us');
  assert.ok(consultados.includes('5562999998888'));
  clienteFalso.info = null;
});

test('número cadastrado sem o código do país é encontrado assim mesmo', async () => {
  registrados.add('5562981718205');
  assert.equal(await driver.enderecoDe('(62) 98171-8205'), '5562981718205@c.us');
  assert.deepEqual(consultados, ['62981718205', '5562981718205']);
});

test('número que a consulta não acha ainda é tentado no envio', async () => {
  // getNumberId devolve nulo também quando a sessão está sincronizando ou o
  // contato não está na agenda. Recusar o envio por isso é pior que tentar:
  // foi o que segurou um agendamento real de chegar à recepção.
  const endereco = await driver.enderecoDe('5527992224359');
  assert.equal(endereco, '5527992224359@c.us');
  assert.deepEqual(consultados, ['5527992224359', '552792224359']);
});

test('verificar confirma um número registrado', async () => {
  clienteFalso.info = { wid: { user: '5562981718205', _serialized: '5562981718205@c.us' } };
  registrados.add('5562999998888');
  const r = await driver.verificar('5562999998888');
  assert.equal(r.ok, true);
  assert.match(r.mensagem, /confirmado/i);
  clienteFalso.info = null;
});

test('verificar avisa sem afirmar que o número não existe', async () => {
  clienteFalso.info = { wid: { user: '5562981718205', _serialized: '5562981718205@c.us' } };
  const r = await driver.verificar('5527992224359');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'nao_confirmado');
  assert.match(r.mensagem, /tentar enviar/, 'diz que o envio continua acontecendo');
  assert.ok(!/não existe/.test(r.mensagem));
  clienteFalso.info = null;
});

test('verificar recusa formato impossível sem consultar', async () => {
  const r = await driver.verificar('123');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'formato');
  assert.deepEqual(consultados, []);
});

test('verificar reconhece o próprio número da sessão', async () => {
  clienteFalso.info = { wid: { user: '5562981718205', _serialized: '5562981718205@c.us' } };
  const r = await driver.verificar('5562981718205');
  assert.equal(r.ok, true);
  assert.match(r.mensagem, /próprio número/);
  clienteFalso.info = null;
});

test('o sistema não obedece à própria resposta "não entendi"', () => {
  // Este é o laço que rodou em produção: a resposta "não entendi" contém
  // "CONFIRMAR PA-x", e o protocolo a lê como comando de confirmar.
  const naoEntendi = 'Recebi PA-2026-6029, mas não entendi o que fazer. '
    + 'Responda *CONFIRMAR PA-2026-6029* ou *REMARCAR PA-2026-6029*.';
  assert.equal(require('../src/protocolo').interpretar(naoEntendi).comando, 'CONFIRMAR',
    'o texto de fato parece um comando — por isso a barreira precisa existir');

  driver._lembrarTexto(naoEntendi);

  // eco sem id ainda resolvido: é o caso que o rastreio por id não pega
  assert.equal(driver._nossa({ fromMe: true, body: naoEntendi, id: {} }), true);
  // a mesma frase vinda de fora não é nossa
  assert.equal(driver._nossa({ fromMe: false, body: naoEntendi, id: {} }), false);
  // e um comando de verdade da recepção passa
  assert.equal(driver._nossa({ fromMe: true, body: 'CONFIRMAR PA-2026-6029', id: {} }), false);
});

test('espaço em volta não engana a barreira', () => {
  driver._lembrarTexto('Feito. PA-2026-0001 confirmado na agenda do INGOH.');
  assert.equal(driver._nossa({
    fromMe: true, body: '  Feito. PA-2026-0001 confirmado na agenda do INGOH.  ', id: {},
  }), true);
});
