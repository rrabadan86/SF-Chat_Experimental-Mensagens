// Senha do robô recusada pelo EVO (evo-login-estado.js): o robô para de tentar entrar
// — insistir é o que faz o EVO bloquear o usuário ("excedeu o número de tentativas") —
// e avisa com o que fazer. Em 11/2026 chegavam só "TIMEOUT" e "Waiting failed".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambienteIsolado } = require('../ajuda');

const HORA = 3600 * 1000;
// Notificações de mentira: guarda o que seria avisado.
const avisosFalsos = (amb) => {
  const lista = [];
  const arq = amb.arq('notificar');
  require.cache[arq] = { id: arq, filename: arq, loaded: true, exports: { alertar: async (titulo, mensagem) => { lista.push({ titulo, mensagem }); return true; }, alertarResumo: async () => false } };
  return lista;
};
// Página de mentira do EVO: `avisos` = o que o EVO mostra depois do ENTRAR.
const pagina = (estado) => ({
  evaluate: async (fn) => { const t = String(fn); if (t.includes('snack')) return estado.avisos; if (t.includes('location.hash')) return !!estado.seguiu; return ''; },
  $: async () => null,
});

test('EVO-01 reconhece a recusa de senha do EVO e não confunde com código inválido', () => {
  const amb = ambienteIsolado();
  try {
    const { ehRecusa } = amb.req('evo-login-estado');
    for (const t of ['InvalID username and/or password.', 'Invalid username and/or password', 'Usuário e/ou senha inválidos', 'Usuário ou senha inválidos', 'E-mail ou senha inválidos']) assert.strictEqual(ehRecusa(t), true, t);
    for (const t of ['', 'Código inválido', 'Código expirado', 'Campo obrigatório', 'Você excedeu o número de tentativas de acesso ao sistema.']) assert.strictEqual(ehRecusa(t), false, t);
  } finally { amb.limpar(); }
});

test('EVO-01 senha recusada: avisa uma vez, os jobs seguintes não tentam entrar, e salvar o login libera', async () => {
  const amb = ambienteIsolado();
  try {
    const avisos = avisosFalsos(amb);
    const arqEnv = path.join(amb.exp, '.env');
    fs.writeFileSync(arqEnv, 'EVO_EMAIL=robo@exemplo.com.br\n');
    const velho = Date.now() / 1000 - 3600; fs.utimesSync(arqEnv, velho, velho); // .env mexido há 1 h
    const est = amb.req('evo-login-estado'), totp = amb.req('evo-totp');
    assert.strictEqual(est.bloqueio(), null);
    assert.doesNotThrow(() => est.conferir());

    // o EVO responde "Invalid username and/or password" logo depois do ENTRAR
    assert.strictEqual(await totp.notarRecusa(pagina({ avisos: 'InvalID username and/or password.' }), 50), true);
    assert.strictEqual(avisos.length, 1);
    assert.match(avisos[0].titulo, /recusou a senha/);
    assert.match(avisos[0].mensagem, /Login do robô no EVO/);
    // qualquer job que for entrar agora para ANTES de digitar o login, com a mensagem certa
    assert.throws(() => est.conferir(), /O EVO recusou a senha do robô/);
    assert.throws(() => est.conferir(), (e) => e.evoLogin === 'senha' && !/timeout|waiting failed/i.test(e.message), 'o robô não repete sozinho (não parece instabilidade)');
    assert.strictEqual(avisos.length, 1, 'ficar travado não gera aviso novo');

    // ainda travado 5 h depois; com 6 h, uma tentativa nova é permitida
    assert.ok(est.bloqueio(Date.now() + 5 * HORA));
    assert.strictEqual(est.bloqueio(Date.now() + 6 * HORA + 1000), null);

    // salvar o login no painel libera na hora
    est.liberar();
    assert.doesNotThrow(() => est.conferir());

    // recusa de novo; desta vez alguém corrige o .env à mão no servidor → também libera
    await est.registrarRecusa('Invalid username and/or password.');
    assert.throws(() => est.conferir());
    const depois = Date.now() / 1000 + 5; fs.utimesSync(arqEnv, depois, depois);
    assert.doesNotThrow(() => est.conferir());
  } finally { amb.limpar(); }
});

test('EVO-01 login que seguiu normal (entrou, ou abriu a tela do código) não é tratado como recusa', async () => {
  const amb = ambienteIsolado();
  try {
    const avisos = avisosFalsos(amb);
    const est = amb.req('evo-login-estado'), totp = amb.req('evo-totp');
    assert.strictEqual(await totp.notarRecusa(pagina({ avisos: '', seguiu: true }), 2000), false);
    assert.strictEqual(await totp.notarRecusa(pagina({ avisos: 'Código inválido' }), 50), false);
    assert.strictEqual(est.bloqueio(), null);
    assert.strictEqual(avisos.length, 0);
  } finally { amb.limpar(); }
});

test('EVO-01 código do EVO que ninguém digitou: o mesmo job não pede outro logo em seguida; a recusa de senha manda mais', async () => {
  const amb = ambienteIsolado();
  try {
    avisosFalsos(amb);
    const est = amb.req('evo-login-estado');
    est.registrarSemCodigo();
    assert.throws(() => est.conferir(), /código por e-mail e ninguém digitou/);
    assert.strictEqual(est.bloqueio(Date.now() + est.ESPERA_CODIGO_MS + 1000), null, 'passados 3 min, pode pedir de novo');
    await est.registrarRecusa('Invalid username and/or password.');
    est.registrarSemCodigo();
    assert.strictEqual(est.bloqueio().motivo, 'senha', 'não troca a recusa de senha por "faltou o código"');
  } finally { amb.limpar(); }
});

test('EVO-01 todo job que entra no EVO confere a trava antes de digitar o login', () => {
  const src = path.resolve(__dirname, '..', '..', 'src');
  const semTrava = [];
  for (const f of fs.readdirSync(src).filter(n => n.endsWith('.js'))) {
    const linhas = fs.readFileSync(path.join(src, f), 'utf8').split('\n');
    linhas.forEach((l, i) => { if (/\.type\(.*config\.evo\.email/.test(l) && !/evo-login-estado'\)\.conferir\(\)/.test(linhas[i - 1] || '')) semTrava.push(`${f}:${i + 1}`); });
  }
  assert.deepStrictEqual(semTrava, [], 'login no EVO sem conferir a trava (ponha require(\'./evo-login-estado\').conferir() na linha de cima)');
});
