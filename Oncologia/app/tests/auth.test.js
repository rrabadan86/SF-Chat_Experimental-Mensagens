require('./ambiente');
const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../src/auth');

test('senha certa entra, senha errada não', () => {
  const guardado = auth.gerarHash('abacaxi-com-hortela');
  assert.equal(auth.conferirSenha('abacaxi-com-hortela', guardado), true);
  assert.equal(auth.conferirSenha('abacaxi-com-hortela ', guardado), false);
  assert.equal(auth.conferirSenha('outra', guardado), false);
  assert.equal(auth.conferirSenha('', guardado), false);
});

test('a mesma senha gera hashes diferentes (salt por senha)', () => {
  const a = auth.gerarHash('mesma-senha');
  const b = auth.gerarHash('mesma-senha');
  assert.notEqual(a, b);
  assert.equal(auth.conferirSenha('mesma-senha', a), true);
  assert.equal(auth.conferirSenha('mesma-senha', b), true);
});

test('a senha nunca aparece no que é guardado', () => {
  assert.ok(!auth.gerarHash('minha-senha-secreta').includes('minha-senha-secreta'));
});

test('hash malformado não derruba nem libera', () => {
  for (const lixo of [null, '', 'abc', 'scrypt$', 'md5$a$b', 'scrypt$sal$zz']) {
    assert.equal(auth.conferirSenha('qualquer', lixo), false);
  }
});

test('token assinado é aceito; token adulterado não', () => {
  const token = auth.criarToken();
  assert.equal(auth.tokenValido(token), true);

  const [corpo, assinatura] = token.split('.');
  assert.equal(auth.tokenValido(corpo + '.' + 'x'.repeat(assinatura.length)), false);
  assert.equal(auth.tokenValido(Buffer.from('{"exp":99999999999999}').toString('base64url') + '.' + assinatura), false);
  assert.equal(auth.tokenValido('sem-ponto'), false);
  assert.equal(auth.tokenValido(null), false);
});

test('token vencido é recusado', () => {
  const original = auth.VALIDADE_HORAS;
  const vencido = Buffer.from(JSON.stringify({ exp: Date.now() - 1000, n: 'x' })).toString('base64url');
  const crypto = require('node:crypto');
  const assinatura = crypto.createHmac('sha256', process.env.ADMIN_SEGREDO).update(vencido).digest('base64url');
  assert.equal(auth.tokenValido(`${vencido}.${assinatura}`), false);
  assert.equal(original > 0, true);
});

test('trocar o segredo invalida os cookies existentes', () => {
  const token = auth.criarToken();
  const antes = process.env.ADMIN_SEGREDO;
  process.env.ADMIN_SEGREDO = 'outro-segredo-bem-diferente-aqui';
  assert.equal(auth.tokenValido(token), false);
  process.env.ADMIN_SEGREDO = antes;
});

test('freio de força bruta corta depois de 8 tentativas', () => {
  const ip = '203.0.113.9';
  for (let i = 0; i < 8; i++) {
    assert.equal(auth.podeTentar(ip), true);
    auth.registrarFalha(ip);
  }
  assert.equal(auth.podeTentar(ip), false);
  auth.limparTentativas(ip);
  assert.equal(auth.podeTentar(ip), true);
});
