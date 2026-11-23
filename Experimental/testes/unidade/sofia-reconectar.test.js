// "🔧 Reconectar a SoFIA" (painel) e o comando slimfit-sofia usam os mesmos passos
// (sofia-destravar.js): tenta voltar com o login salvo; se não conectar, descarta o
// login e mostra um QR novo. Nunca apaga conversas, tags ou configurações.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ambienteIsolado } = require('../ajuda');

// SoFIA de mentira: a cada "pm2 start" ela publica o estado que o teste mandar.
function sofiaFalsa(amb, aoSubir) {
  const dir = amb.sofia, auth = path.join(dir, '.wwebjs_auth');
  fs.mkdirSync(path.join(auth, 'session'), { recursive: true });
  for (const t of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) fs.writeFileSync(path.join(auth, 'session', t), 'x');
  fs.writeFileSync(path.join(auth, 'session', 'login-salvo'), 'sessao');
  fs.mkdirSync(path.join(dir, '.wwebjs_cache')); fs.writeFileSync(path.join(dir, '.wwebjs_cache', 'velho.html'), 'x');
  fs.writeFileSync(path.join(dir, '.sofia-boot-fails'), '8');
  amb.gravarSofia('sofia-conversas.json', { '5562999990001': { nome: 'Ana', msgs: [] } });
  amb.gravarSofia('sofia-wa-status.json', { estado: 'desconectado', atualizadoEm: new Date(Date.now() - 3600e3).toISOString() });
  let relogio = Date.now();
  const chamadas = [];
  const alvo = {
    pm2Id: 'unidade-sofia', dir, auth,
    agora: () => relogio,
    dormir: async (ms) => { relogio += ms; },
    pm2: async (args) => {
      chamadas.push(args.join(' '));
      if (args[0] !== 'start') return;
      const qrNovo = fs.existsSync(path.join(dir, '.sofia-limpar-auth'));
      const estado = aoSubir(qrNovo);
      if (estado) amb.gravarSofia('sofia-wa-status.json', { estado, atualizadoEm: new Date(relogio + 1000).toISOString() });
    },
  };
  return { alvo, chamadas, dir, auth };
}

test('reconectar: volta com o login salvo e não descarta nada', async () => {
  const amb = ambienteIsolado();
  try {
    const f = sofiaFalsa(amb, () => 'conectado');
    const etapas = [];
    const r = await amb.req('sofia-destravar').destravar(f.alvo, (e) => etapas.push(e.etapa));
    assert.strictEqual(r, 'conectado');
    assert.deepStrictEqual(f.chamadas, ['stop unidade-sofia', 'start unidade-sofia'], 'parou e subiu uma vez só');
    assert.ok(!etapas.includes('qr-novo'), 'não precisou do QR novo');
    assert.ok(!fs.existsSync(path.join(f.dir, '.sofia-limpar-auth')), 'o login salvo fica');
    assert.ok(fs.existsSync(path.join(f.auth, 'session', 'login-salvo')));
    assert.strictEqual(fs.readFileSync(path.join(f.dir, '.sofia-boot-fails'), 'utf8'), '0', 'contador de falhas zerado');
    assert.ok(!fs.existsSync(path.join(f.dir, '.wwebjs_cache')), 'cache do WhatsApp Web limpo');
    assert.ok(!fs.existsSync(path.join(f.auth, 'session', 'SingletonLock')), 'trava do navegador removida');
    assert.ok(JSON.parse(fs.readFileSync(path.join(f.dir, 'sofia-conversas.json'), 'utf8'))['5562999990001'], 'as conversas não são tocadas');
  } finally { amb.limpar(); }
});

test('reconectar: se não volta em 2 min com o login salvo, passa sozinho para o QR novo', async () => {
  const amb = ambienteIsolado();
  try {
    // com o login salvo a SoFIA fica "iniciando/desconectado" (como no Lago Norte); sem ele, mostra o QR
    const f = sofiaFalsa(amb, (qrNovo) => (qrNovo ? 'qr' : 'desconectado'));
    const etapas = [];
    const r = await amb.req('sofia-destravar').destravar(f.alvo, (e) => { if (etapas[etapas.length - 1] !== e.etapa) etapas.push(e.etapa); });
    assert.strictEqual(r, 'qr');
    assert.deepStrictEqual(etapas, ['reconectando', 'qr-novo', 'qr']);
    assert.deepStrictEqual(f.chamadas, ['stop unidade-sofia', 'start unidade-sofia', 'stop unidade-sofia', 'start unidade-sofia']);
    assert.ok(fs.existsSync(path.join(f.dir, '.sofia-limpar-auth')), 'no 2º passo a SoFIA é avisada para descartar o login ao subir');
    assert.ok(JSON.parse(fs.readFileSync(path.join(f.dir, 'sofia-conversas.json'), 'utf8'))['5562999990001'], 'as conversas não são tocadas');
  } finally { amb.limpar(); }
});

test('reconectar: se nem o QR novo aparece, termina como "falhou" (não fica tentando para sempre)', async () => {
  const amb = ambienteIsolado();
  try {
    const f = sofiaFalsa(amb, () => 'iniciando');
    const r = await amb.req('sofia-destravar').destravar(f.alvo);
    assert.strictEqual(r, 'falhou');
    assert.strictEqual(f.chamadas.filter(c => c.startsWith('start')).length, 2, 'duas tentativas e para');
    // um estado ANTIGO de "conectado" (de antes de reiniciar) não engana a espera
    const g = sofiaFalsa(amb, () => '');
    amb.gravarSofia('sofia-wa-status.json', { estado: 'conectado', atualizadoEm: new Date(Date.now() - 3600e3).toISOString() });
    assert.strictEqual(await amb.req('sofia-destravar').destravar(g.alvo), 'falhou');
  } finally { amb.limpar(); }
});

const pedir = (porta, metodo, url, cookie) => new Promise((ok) => {
  const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: metodo, timeout: 8000, headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Length': 0 } }, (res) => {
    let b = ''; res.on('data', d => { b += d; }); res.on('end', () => ok({ st: res.statusCode, corpo: b }));
  });
  req.on('timeout', () => { req.destroy(); ok({ st: 0 }); }); req.on('error', () => ok({ st: 0 })); req.end();
});
const entrar = (porta, usuario, senha) => new Promise((ok) => {
  const corpo = `usuario=${usuario}&senha=${senha}`;
  const req = http.request({ host: '127.0.0.1', port: porta, path: '/login', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(corpo) } }, (res) => { res.resume(); res.on('end', () => ok(String((res.headers['set-cookie'] || [])[0] || '').split(';')[0])); });
  req.on('error', () => ok('')); req.end(corpo);
});

test('no painel: o botão dispara o procedimento na SoFIA desta unidade; quem não tem acesso à Configuração da SoFIA não consegue', { timeout: 120000 }, async () => {
  const amb = ambienteIsolado();
  const porta = 22000 + Math.floor(Math.random() * 900);
  const PAINEL = 'exemplo-do-painel-123';
  let painel;
  try {
    amb.gravarSofia('sofia-prompt.txt', 'prompt de teste');
    amb.gravarSofia('sofia-wa-status.json', { estado: 'desconectado', atualizadoEm: new Date(Date.now() - 3600e3).toISOString() });
    fs.writeFileSync(path.join(amb.sofia, '.sofia-boot-fails'), '8');
    fs.writeFileSync(path.join(amb.exp, '.env'), `PAINEL_PORT=${porta}\nPAINEL_HOST=127.0.0.1\nPAINEL_USER=dono\nPAINEL_SENHA=${PAINEL}\nSOFIA_DIR=${amb.sofia}\nPM2_SLUG=unidade\n`);
    amb.req('usuarios').criar({ usuario: 'recepcao', senha: 'teste-1234', telas: ['sofia_conversas'] });
    const env = { ...process.env }; for (const k of ['PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_USER', 'PAINEL_SENHA', 'SOFIA_DIR', 'PM2_BIN', 'PM2_SLUG']) delete env[k];
    // (o painel do teste roda com os comandos do sistema bloqueados — bloqueios.js)
    painel = spawn(process.execPath, ['-r', path.resolve(__dirname, '..', 'bloqueios.js'), 'src/painel-mensagens.js'], { cwd: amb.exp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 60; i++) { const r = await pedir(porta, 'GET', '/login'); if (r.st) break; await new Promise(r => setTimeout(r, 300)); }

    assert.strictEqual((await pedir(porta, 'POST', '/sofia/reconectar')).st, 401, 'sem login não reconecta');
    assert.strictEqual((await pedir(porta, 'POST', '/sofia/reconectar', await entrar(porta, 'recepcao', 'teste-1234'))).st, 403, 'só quem tem a Configuração da SoFIA');
    assert.strictEqual(fs.readFileSync(path.join(amb.sofia, '.sofia-boot-fails'), 'utf8'), '8', 'nada foi mexido até aqui');

    const adm = await entrar(porta, 'dono', PAINEL);
    assert.match((await pedir(porta, 'GET', '/sofia', adm)).corpo, /Reconectar a SoFIA/, 'a tela tem o botão');
    assert.strictEqual(JSON.parse((await pedir(porta, 'GET', '/sofia/estado', adm)).corpo).reconectar, null, 'nada rodando antes do clique');
    assert.deepStrictEqual(JSON.parse((await pedir(porta, 'POST', '/sofia/reconectar', adm)).corpo), { ok: true });
    let fim = null;
    for (let i = 0; i < 40 && !fim; i++) {
      await new Promise(r => setTimeout(r, 250));
      const e = JSON.parse((await pedir(porta, 'GET', '/sofia/estado', adm)).corpo);
      if (e.reconectar && !e.reconectar.rodando) fim = e;
    }
    assert.ok(fim, 'o procedimento terminou e a tela fica sabendo');
    // no teste o "pm2 start" é bloqueado: o painel informa a falha em vez de ficar "rodando" para sempre
    assert.strictEqual(fim.reconectar.etapa, 'falhou');
    // e os passos foram feitos na pasta da SoFIA DESTA instalação
    assert.strictEqual(fs.readFileSync(path.join(amb.sofia, '.sofia-boot-fails'), 'utf8'), '0');
    assert.ok(!fs.existsSync(path.join(amb.sofia, '.sofia-limpar-auth')), 'sem conseguir subir a SoFIA, não chega a descartar o login');
    // clicar de novo logo em seguida não reinicia outra vez (reiniciar em sequência pode fazer o WhatsApp bloquear o número)
    fs.writeFileSync(path.join(amb.sofia, '.sofia-boot-fails'), '3');
    const denovo = JSON.parse((await pedir(porta, 'POST', '/sofia/reconectar', adm)).corpo);
    assert.strictEqual(denovo.ok, false);
    assert.match(denovo.erro, /Espere \d+ min/);
    assert.strictEqual(fs.readFileSync(path.join(amb.sofia, '.sofia-boot-fails'), 'utf8'), '3', 'nada foi mexido na segunda vez');
  } finally { if (painel) painel.kill(); amb.limpar(); }
});
