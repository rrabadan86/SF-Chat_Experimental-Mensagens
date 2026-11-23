// Regras simples que muita coisa usa: telefone (com/sem o 9), tags do funil e o
// preenchimento das mensagens ({nome}, {horario}…).
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado } = require('../ajuda');

const amb = ambienteIsolado();
test.after(() => amb.limpar());

test('ENV-07 telefone: normaliza e reconhece com e sem o 9', () => {
  const c = amb.req('contatos');
  assert.strictEqual(c.normTel('(62) 98111-0001'), '5562981110001');
  assert.strictEqual(c.normTel('5562981110001'), '5562981110001');
  assert.strictEqual(c.normTel('123'), '', 'curto demais não é telefone');
  assert.deepStrictEqual(c.variantes9('62981110001').sort(), ['556281110001', '5562981110001'].sort());
  assert.deepStrictEqual(c.variantes9('6281110001').sort(), ['556281110001', '5562981110001'].sort());
});

test('ENV-07 contato é achado pelo telefone mesmo sem o 9', () => {
  const c = amb.req('contatos');
  const map = { '5562981110001': { tel: '5562981110001', nome: 'Ana', tags: [] } };
  assert.strictEqual(c.acharPorTel('556281110001', map).contato.nome, 'Ana');
  assert.strictEqual(c.acharPorTel('5562999999999', map), null);
});

test('TAG-01 tags do funil: entrar numa etapa tira a anterior, e a tag que chega fica', () => {
  amb.gravarData('tags-config.json', {
    'FX - 5. Fez Aula Experimental': { remove: ['FX - 0. Sem interesse', 'FX - 3. Agendou Aula Exp'] },
    'FX - 3. Agendou Aula Exp': { remove: ['FX - 1. Contato inicial'] },
  });
  const c = amb.req('contatos');
  const tags = (tel) => c.acharPorTel(tel).contato.tags;
  // entrar em "Agendou" tira "Contato inicial"
  c.adicionarTag('5562981110001', 'Ana', 'FX - 1. Contato inicial');
  c.adicionarTag('5562981110001', 'Ana', 'FX - 3. Agendou Aula Exp');
  assert.deepStrictEqual(tags('5562981110001'), ['FX - 3. Agendou Aula Exp']);
  // mesmo número SEM o 9: não cria contato duplicado
  c.adicionarTag('556281110001', 'Ana', 'FX - 5. Fez Aula Experimental');
  assert.strictEqual(Object.keys(c.carregar()).length, 1);
  assert.deepStrictEqual(tags('5562981110001'), ['FX - 5. Fez Aula Experimental']);
  // quem já fez aula e recebe "Sem interesse" fica COM a tag nova (antes ela sumia na hora)
  assert.strictEqual(c.adicionarTag('5562981110001', 'Ana', 'FX - 0. Sem interesse'), true);
  assert.ok(tags('5562981110001').includes('FX - 0. Sem interesse'));
});

test('ENV-06 mensagens: preenche as variáveis e some com {nome} quando não há nome', () => {
  const m = amb.req('mensagens');
  assert.strictEqual(m.renderTexto('Oi, {nome}! Aula às {horario}.', { nome: 'Ana', horario: '09:30' }), 'Oi, Ana! Aula às 09:30.');
  const semNome = m.renderTexto('Oi, {nome}! Tudo bem?', {});
  assert.ok(!/\{nome\}|undefined|null/.test(semNome), `ficou: "${semNome}"`);
});

test('ENV-06 mensagens: todo texto padrão do catálogo existe e não tem variável desconhecida solta', () => {
  const m = amb.req('mensagens');
  for (const item of m.CATALOGO || []) {
    const t = m.texto(item.chave);
    assert.ok(t && t.trim(), `mensagem sem texto: ${item.chave}`);
    const preenchido = m.renderTexto(t, m.exemplosDe(item.chave));
    assert.ok(!/undefined|NaN|\bnull\b/.test(preenchido), `${item.chave} gerou: ${preenchido.slice(0, 120)}`);
  }
});
