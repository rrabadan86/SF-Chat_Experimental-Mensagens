// Login do robô no EVO salvo pelo painel (WhatsApp → Configuração). A senha que o
// robô lê tem de ser EXATAMENTE a digitada: em 11/2026 uma senha com "#" era gravada
// de um jeito que o robô lia só o começo dela — e o EVO bloqueava o usuário por
// excesso de tentativas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { ambienteIsolado } = require('../ajuda');

// Tudo aqui é de mentira (valores de exemplo, criados para o teste).
const ANTIGA = 'exemplo-antiga', PAINEL = 'exemplo-do-painel-123';
const SENHAS = ['Abc12345', 'Slim#2026', 'Fit$$2026', 'a$&b', "x$'y", 'com espaco', '"aspas"', "it's", 'barra\\n', 'p@ss=word!', 'fim#', 'a`b', "mist'ura\"dupla", '#começa', '$1$2', 'ç~ã é'];

test('.env: o valor lido é sempre igual ao gravado (#, $, aspas, espaço…)', () => {
  const amb = ambienteIsolado();
  try {
    const env = amb.req('env-arquivo'), arq = path.join(amb.exp, '.env');
    for (const senha of SENHAS) {
      fs.writeFileSync(arq, `OUTRA=1\nEVO_PASSWORD=${ANTIGA}\nFIM=dois # comentário\n`);
      assert.deepStrictEqual(env.gravar('EVO_PASSWORD', senha, arq), { ok: true }, senha);
      assert.strictEqual(env.ler('EVO_PASSWORD', arq), senha);
      assert.strictEqual(env.ler('OUTRA', arq), '1', 'o resto do arquivo fica como estava');
      assert.strictEqual(env.ler('FIM', arq), 'dois');
    }
    // chave de API e e-mail continuam sem aspas (como sempre foram gravados)
    env.gravar('EVO_EMAIL', 'robo@exemplo.com.br', arq);
    assert.match(fs.readFileSync(arq, 'utf8'), /^EVO_EMAIL=robo@exemplo\.com\.br$/m);
  } finally { amb.limpar(); }
});

test('.env: linha repetida vira uma só; valor impossível de gravar não altera o arquivo', () => {
  const amb = ambienteIsolado();
  try {
    const env = amb.req('env-arquivo'), arq = path.join(amb.exp, '.env');
    fs.writeFileSync(arq, `EVO_PASSWORD=${ANTIGA}1\nX=1\nEVO_PASSWORD=${ANTIGA}2\n`);
    assert.strictEqual(env.gravar('EVO_PASSWORD', 'nova#1', arq).ok, true);
    assert.strictEqual(env.ler('EVO_PASSWORD', arq), 'nova#1', 'antes o painel trocava a 1ª linha e o robô lia a última');
    assert.strictEqual((fs.readFileSync(arq, 'utf8').match(/^EVO_PASSWORD=/gm) || []).length, 1);
    const antes = fs.readFileSync(arq, 'utf8');
    for (const ruim of ['duas\nlinhas', 'a\'b"c`d']) {
      const r = env.gravar('EVO_PASSWORD', ruim, arq);
      assert.strictEqual(r.ok, false);
      assert.ok(r.erro);
      assert.strictEqual(fs.readFileSync(arq, 'utf8'), antes, 'nada mudou');
    }
    // arquivo que ainda não existe
    const novo = path.join(amb.exp, 'novo', '.env');
    assert.strictEqual(env.gravar('EVO_PASSWORD', 'a#b', novo).ok, true);
    assert.strictEqual(env.ler('EVO_PASSWORD', novo), 'a#b');
  } finally { amb.limpar(); }
});

test('robô: lê o login do .env na hora de cada login (senha trocada vale sem reiniciar)', () => {
  const amb = ambienteIsolado();
  try {
    const arq = path.join(amb.exp, '.env');
    fs.writeFileSync(arq, `EVO_EMAIL=robo@exemplo.com.br\nEVO_PASSWORD=${ANTIGA}\n`);
    const antigos = { e: process.env.EVO_EMAIL, p: process.env.EVO_PASSWORD };
    try {
      const config = amb.req('config');
      assert.strictEqual(config.evo.password, ANTIGA);
      amb.req('env-arquivo').gravar('EVO_PASSWORD', 'Segunda#2026 $$', arq);
      assert.strictEqual(config.evo.password, 'Segunda#2026 $$', 'o mesmo processo já enxerga a senha nova');
      assert.strictEqual(config.evo.email, 'robo@exemplo.com.br');
    } finally {
      for (const [k, v] of [['EVO_EMAIL', antigos.e], ['EVO_PASSWORD', antigos.p]]) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    }
  } finally { amb.limpar(); }
});

const pedir = (porta, metodo, url, cookie, corpo) => new Promise((ok) => {
  const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: metodo, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } : {}) } }, (res) => {
    let b = ''; res.on('data', d => { b += d; }); res.on('end', () => ok({ st: res.statusCode, corpo: b, cookie: res.headers['set-cookie'] }));
  });
  req.on('error', () => ok({ st: 0 }));
  req.end(corpo);
});
const entrar = async (porta, usuario, senha) => {
  const r = await new Promise((ok) => {
    const corpo = `usuario=${usuario}&senha=${senha}`;
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/login', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(corpo) } }, (res) => { res.resume(); res.on('end', () => ok(res.headers['set-cookie'])); });
    req.on('error', () => ok(null)); req.end(corpo);
  });
  return String((r || [])[0] || '').split(';')[0];
};

test('no painel: a senha salva pelo administrador é a que o robô lê; quem não é administrador não salva', { timeout: 120000 }, async () => {
  const amb = ambienteIsolado();
  const porta = 21000 + Math.floor(Math.random() * 900);
  let painel;
  try {
    const arq = path.join(amb.exp, '.env');
    fs.writeFileSync(arq, `PAINEL_PORT=${porta}\nPAINEL_HOST=127.0.0.1\nPAINEL_USER=dono\nPAINEL_SENHA=${PAINEL}\nSOFIA_DIR=${amb.sofia}\nEVO_EMAIL=velho@exemplo.com.br\nEVO_PASSWORD=${ANTIGA}\n`);
    amb.req('usuarios').criar({ usuario: 'recepcao', senha: 'teste-1234', telas: ['sofia_conversas'] });
    const env = { ...process.env }; for (const k of ['PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_USER', 'PAINEL_SENHA', 'SOFIA_DIR', 'EVO_EMAIL', 'EVO_PASSWORD']) delete env[k];
    painel = spawn(process.execPath, ['-r', path.resolve(__dirname, '..', 'bloqueios.js'), 'src/painel-mensagens.js'], { cwd: amb.exp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 60; i++) { const r = await pedir(porta, 'GET', '/login'); if (r.st) break; await new Promise(r => setTimeout(r, 300)); }
    // o que o robô leria: um processo novo, sem nada herdado, carregando o config.js
    const roboLe = () => JSON.parse(execFileSync(process.execPath, ['-e', "const c=require('./src/config');process.stdout.write(JSON.stringify([c.evo.email,c.evo.password]))"], { cwd: amb.exp, env }).toString());

    const nova = 'Slim#Fit$$2026 "ok"';
    const corpo = JSON.stringify({ email: 'robo@exemplo.com.br', senha: nova });
    assert.strictEqual((await pedir(porta, 'POST', '/sofia/evo-credenciais', '', corpo)).st, 401, 'sem login não salva');
    assert.strictEqual((await pedir(porta, 'POST', '/sofia/evo-credenciais', await entrar(porta, 'recepcao', 'teste-1234'), corpo)).st, 403, 'só o administrador');
    assert.deepStrictEqual(roboLe(), ['velho@exemplo.com.br', ANTIGA]);

    const adm = await entrar(porta, 'dono', PAINEL);
    const r = await pedir(porta, 'POST', '/sofia/evo-credenciais', adm, corpo);
    assert.deepStrictEqual(JSON.parse(r.corpo), { ok: true, conferido: true, tamanho: nova.length });
    assert.deepStrictEqual(roboLe(), ['robo@exemplo.com.br', nova]);
    assert.ok(!r.corpo.includes('Slim'), 'a resposta não devolve a senha');
    // senha em branco mantém a atual
    assert.deepStrictEqual(JSON.parse((await pedir(porta, 'POST', '/sofia/evo-credenciais', adm, JSON.stringify({ email: 'outro@exemplo.com.br', senha: '' }))).corpo), { ok: true, conferido: false, tamanho: 0 });
    assert.deepStrictEqual(roboLe(), ['outro@exemplo.com.br', nova]);
    // o resto do .env ficou inteiro (o painel continua entrando com a mesma senha)
    assert.ok(await entrar(porta, 'dono', PAINEL));
    assert.strictEqual(amb.req('env-arquivo').ler('PAINEL_SENHA', arq), PAINEL);
  } finally { if (painel) painel.kill(); amb.limpar(); }
});
