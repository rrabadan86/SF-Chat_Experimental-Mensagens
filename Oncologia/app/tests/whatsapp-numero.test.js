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

test('número sem WhatsApp explica o problema em vez de falhar seco', async () => {
  await assert.rejects(
    () => driver.enderecoDe('5562900000000'),
    (e) => /não foi encontrado no WhatsApp/.test(e.message) && /55 \+ DDD/.test(e.message)
  );
});

test('número vazio nem consulta o WhatsApp', async () => {
  await assert.rejects(() => driver.enderecoDe('  '), /vazio/);
  assert.equal(consultados.length, 0);
});

test('a máscara do número é ignorada', async () => {
  registrados.add('5562981718205');
  assert.equal(await driver.enderecoDe('+55 (62) 98171-8205'), '5562981718205@c.us');
});
