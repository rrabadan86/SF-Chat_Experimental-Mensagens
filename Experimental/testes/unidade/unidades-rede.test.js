// Acesso único às unidades (/unidades): a lista só aceita endereço seguro, a tela
// é pública mas não entrega sessão, e só o administrador muda a lista.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ambienteIsolado, portaLivre } = require('../ajuda');

test('lista de unidades: só entra endereço https, sem repetição e sem senha no endereço', () => {
  const amb = ambienteIsolado();
  try {
    const u = amb.req('unidades-rede');
    assert.strictEqual(u.normalizarUrl('painel.bueno.com.br'), 'https://painel.bueno.com.br');
    assert.strictEqual(u.normalizarUrl(' https://painel.bueno.com.br/login?x=1 '), 'https://painel.bueno.com.br', 'fica só o endereço, sem caminho');
    assert.strictEqual(u.normalizarUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000', 'http só na própria máquina (testes)');
    assert.throws(() => u.normalizarUrl('http://painel.bueno.com.br'), /https/, 'a senha não pode viajar sem https');
    assert.throws(() => u.normalizarUrl('https://dono:senha@painel.bueno.com.br'), /usuário ou senha/);
    assert.throws(() => u.normalizarUrl('javascript:alert(1)'), /https|válido/);
    assert.throws(() => u.normalizarUrl('https://semponto'), /válido/);
    const l = u.salvarTexto('Bueno | painel.bueno.com.br\n\n  Lago Norte|https://ln.exemplo.com.br/  \n');
    assert.deepStrictEqual(l, [{ nome: 'Bueno', url: 'https://painel.bueno.com.br' }, { nome: 'Lago Norte', url: 'https://ln.exemplo.com.br' }]);
    assert.deepStrictEqual(u.ler(), l);
    assert.strictEqual(u.paraTexto(l), 'Bueno | https://painel.bueno.com.br\nLago Norte | https://ln.exemplo.com.br');
    assert.throws(() => u.salvarTexto('Bueno | a.com.br\nOutra | https://a.com.br'), /repetido/);
    assert.throws(() => u.salvarTexto('só o nome'), /Nome \| endereço/);
    assert.throws(() => u.salvarTexto(' | a.com.br'), /faltou o nome/);
    assert.deepStrictEqual(u.ler(), l, 'lista com erro não substitui a que estava salva');
    // arquivo mexido à mão com endereço inseguro: a entrada ruim é ignorada
    fs.writeFileSync(u.ARQ, JSON.stringify([{ nome: 'Boa', url: 'https://boa.com.br' }, { nome: 'Ruim', url: 'http://ruim.com.br' }, { nome: 'Script', url: 'javascript:alert(1)' }]));
    assert.deepStrictEqual(u.ler(), [{ nome: 'Boa', url: 'https://boa.com.br' }]);
    assert.deepStrictEqual(u.salvarTexto(''), [], 'lista vazia desliga a tela');
  } finally { amb.limpar(); }
});

test('tela de acesso: nome da unidade não vira HTML e o formulário aponta para a unidade escolhida', () => {
  const amb = ambienteIsolado();
  try {
    const { paginaUnidades } = amb.req('painel-publicas');
    const html = paginaUnidades([{ nome: 'Bueno <b>x</b>', url: 'https://a.com.br' }, { nome: 'Lago "Sul"', url: 'https://b.com.br' }], 'https://b.com.br');
    assert.ok(!html.includes('<b>x</b>'), 'o nome foi escrito como texto');
    assert.ok(html.includes('<option value="https://b.com.br" selected>'), 'a unidade deste painel vem escolhida');
    assert.ok(/<form method="POST" action="\/login" id="unForm">/.test(html));
    assert.ok(/name="usuario"/.test(html) && /name="senha"/.test(html));
    assert.ok(/Nenhuma unidade cadastrada/.test(paginaUnidades([], 'https://b.com.br')));
  } finally { amb.limpar(); }
});

const pedir = (porta, metodo, url, cookie, corpo = '') => new Promise((ok) => {
  const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: metodo, timeout: 8000,
    headers: { cookie: cookie || '', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(corpo), accept: 'text/html' } },
  (r) => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ st: r.statusCode, loc: r.headers.location || '', cookie: r.headers['set-cookie'], corpo: b })); });
  req.on('timeout', () => { req.destroy(); ok({ st: 0 }); });
  req.on('error', () => ok({ st: 0 }));
  req.end(corpo);
});

test('no painel: /unidades abre sem login e não dá sessão; só o administrador salva a lista', { timeout: 120000 }, async () => {
  const amb = ambienteIsolado();
  const porta = await portaLivre();
  let painel;
  try {
    fs.writeFileSync(path.join(amb.exp, '.env'), `PAINEL_PORT=${porta}\nPAINEL_HOST=127.0.0.1\nPAINEL_USER=dono\nPAINEL_SENHA=senha-do-teste-123\nSOFIA_DIR=${amb.sofia}\n`);
    amb.req('usuarios').criar({ usuario: 'recepcao', senha: 'teste-1234', telas: ['sofia_conversas'] });
    const env = { ...process.env }; for (const k of ['PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_USER', 'PAINEL_SENHA', 'SOFIA_DIR']) delete env[k];
    painel = spawn(process.execPath, ['-r', path.resolve(__dirname, '..', 'bloqueios.js'), 'src/painel-mensagens.js'], { cwd: amb.exp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 60; i++) { const r = await pedir(porta, 'GET', '/login'); if (r.st) break; await new Promise(r => setTimeout(r, 300)); }

    const vazia = await pedir(porta, 'GET', '/unidades');
    assert.strictEqual(vazia.st, 200, 'a tela de acesso é pública, como a de login');
    assert.ok(/Nenhuma unidade cadastrada/.test(vazia.corpo));
    assert.ok(!vazia.cookie, 'abrir a tela não cria sessão');

    const lista = 'unidades=' + encodeURIComponent(`Esta | http://127.0.0.1:${porta}\nOutra | https://outra.exemplo.com.br`);
    // sem login e com usuário comum: não salva
    assert.strictEqual((await pedir(porta, 'POST', '/perfis/unidades', '', lista)).st, 401, 'sem login não salva');
    const rec = await pedir(porta, 'POST', '/login', '', 'usuario=recepcao&senha=teste-1234');
    const cookieRec = String((rec.cookie || [])[0] || '').split(';')[0];
    assert.strictEqual((await pedir(porta, 'POST', '/perfis/unidades', cookieRec, lista)).st, 403, 'só o administrador muda a lista');
    assert.ok(/Nenhuma unidade cadastrada/.test((await pedir(porta, 'GET', '/unidades')).corpo));

    const adm = await pedir(porta, 'POST', '/login', '', 'usuario=dono&senha=senha-do-teste-123');
    const cookieAdm = String((adm.cookie || [])[0] || '').split(';')[0];
    // endereço inseguro é recusado e nada muda
    const ruim = await pedir(porta, 'POST', '/perfis/unidades', cookieAdm, 'unidades=' + encodeURIComponent('Ruim | http://sem-https.exemplo.com.br'));
    assert.ok(/err=/.test(ruim.loc), 'endereço sem https é recusado');
    const ok = await pedir(porta, 'POST', '/perfis/unidades', cookieAdm, lista);
    assert.ok(/ok=unidades/.test(ok.loc));
    const tela = await pedir(porta, 'GET', '/unidades');
    assert.ok(tela.corpo.includes(`<option value="http://127.0.0.1:${porta}" selected>Esta</option>`));
    assert.ok(tela.corpo.includes('<option value="https://outra.exemplo.com.br">Outra</option>'));
    assert.ok(!/senha-do-teste/.test(tela.corpo));
    // o login enviado pela tela é o login de sempre: senha errada não entra
    const errado = await pedir(porta, 'POST', '/login', '', 'usuario=dono&senha=errada');
    assert.ok(/e=1/.test(errado.loc) && !errado.cookie);
    // o atalho "Trocar de unidade" aparece para o administrador, não para a recepção
    assert.ok(/Trocar de unidade/.test((await pedir(porta, 'GET', '/perfis?view=unidades', cookieAdm)).corpo));
    assert.ok(!/Trocar de unidade/.test((await pedir(porta, 'GET', '/sofia?view=conversas', cookieRec)).corpo));
  } finally { if (painel) painel.kill(); amb.limpar(); }
});
