// PAI-12: quem o admin cria (ou tem a senha redefinida) troca a senha no primeiro acesso.
// Até trocar, o servidor só deixa abrir /trocar-senha e sair.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ambienteIsolado, portaLivre } = require('../ajuda');

const pedir = (porta, metodo, url, cookie, corpo = '') => new Promise((ok) => {
  const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: metodo, timeout: 8000,
    headers: { cookie: cookie || '', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(corpo) } },
  (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => ok({ st: r.statusCode, loc: r.headers.location || '', cookie: r.headers['set-cookie'], corpo: b })); });
  req.on('timeout', () => { req.destroy(); ok({ st: 0 }); });
  req.on('error', () => ok({ st: 0 }));
  req.end(corpo);
});

test('PAI-12 primeiro acesso: só a tela de criar a senha até trocar; regras da senha nova; redefinida pelo admin volta a pedir', { timeout: 120000 }, async () => {
  const amb = ambienteIsolado();
  const porta = await portaLivre();
  let painel;
  try {
    fs.writeFileSync(path.join(amb.exp, '.env'), `PAINEL_PORT=${porta}\nPAINEL_HOST=127.0.0.1\nPAINEL_USER=dono\nPAINEL_SENHA=exemplo-do-dono-123\nSOFIA_DIR=${amb.sofia}\n`);
    amb.gravarSofia('sofia-prompt.txt', 'prompt de exemplo');
    const usuarios = amb.req('usuarios');
    assert.strictEqual(usuarios.criar({ usuario: 'karine', senha: 'inicial-123', telas: ['sofia_conversas'] }).trocarSenha, true, 'criado pelo admin = troca no primeiro acesso');
    const env = { ...process.env }; for (const k of ['PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_USER', 'PAINEL_SENHA', 'SOFIA_DIR']) delete env[k];
    painel = spawn(process.execPath, ['-r', path.resolve(__dirname, '..', 'bloqueios.js'), 'src/painel-mensagens.js'], { cwd: amb.exp, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { const r = await pedir(porta, 'GET', '/login'); if (r.st) break; await new Promise((r) => setTimeout(r, 300)); }
    const entrar = async (u, s) => String(((await pedir(porta, 'POST', '/login', '', `usuario=${u}&senha=${s}`)).cookie || [])[0] || '').split(';')[0];

    const ck = await entrar('karine', 'inicial-123');
    assert.match(ck, /^sf_sess=/);
    for (const u of ['/sofia?view=conversas', '/funil', '/hoje']) {
      const r = await pedir(porta, 'GET', u, ck);
      assert.deepStrictEqual([r.st, r.loc], [303, '/trocar-senha'], `GET ${u} leva para criar a senha`);
    }
    assert.strictEqual((await pedir(porta, 'POST', '/sofia/responder', ck, 'x=1')).st, 403, 'ação negada no servidor até trocar');
    const pg = await pedir(porta, 'GET', '/trocar-senha', ck);
    assert.ok(pg.st === 200 && /Crie sua senha/.test(pg.corpo));
    for (const [corpo, msg] of [['nova=curta&confirma=curta', /pelo menos 8/], ['nova=inicial-123&confirma=inicial-123', /diferente da que você recebeu/], ['nova=nova-senha-1&confirma=outra-senha-1', /não são iguais/], ['nova=karine&confirma=karine', /pelo menos 8/]]) {
      const r = await pedir(porta, 'POST', '/trocar-senha', ck, corpo);
      assert.strictEqual(r.st, 200); assert.match(r.corpo, msg);
    }
    const ok = await pedir(porta, 'POST', '/trocar-senha', ck, 'nova=minha-senha-9&confirma=minha-senha-9');
    assert.strictEqual(ok.st, 303); assert.notStrictEqual(ok.loc, '/trocar-senha');
    assert.strictEqual((await pedir(porta, 'GET', '/sofia?view=conversas', ck)).st, 200, 'depois de trocar, abre as telas dela');
    assert.strictEqual((await pedir(porta, 'GET', '/trocar-senha', ck)).st, 303, 'sem pendência, /trocar-senha só manda para a tela dela');
    assert.match(await entrar('karine', 'minha-senha-9'), /^sf_sess=/, 'entra com a senha nova');
    assert.strictEqual(await entrar('karine', 'inicial-123'), '', 'a senha inicial não vale mais');
    // o admin redefine → pede de novo
    const adm = await entrar('dono', 'exemplo-do-dono-123');
    const red = await pedir(porta, 'POST', '/perfis/senha', adm, 'usuario=karine&senha=outra-inicial-1');
    assert.strictEqual(red.st, 303);
    const ck2 = await entrar('karine', 'outra-inicial-1');
    assert.deepStrictEqual([(await pedir(porta, 'GET', '/funil', ck2)).loc], ['/trocar-senha']);
    assert.strictEqual((await pedir(porta, 'GET', '/perfis', adm)).st, 200, 'o admin do sistema (.env) não é obrigado a trocar');
    const aud = fs.readdirSync(amb.data).filter((f) => /audit/.test(f)).map((f) => fs.readFileSync(path.join(amb.data, f), 'utf8')).join('\n');
    assert.match(aud, /perfil\.senha\.propria/, 'a troca fica na Auditoria');
  } finally { if (painel) painel.kill(); amb.limpar(); }
});
