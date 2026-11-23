// "🔧 Reconectar a SoFIA" (painel) e o comando slimfit-sofia usam os mesmos passos
// (sofia-destravar.js): tenta voltar com o login salvo; se não conectar, descarta o
// login e mostra um QR novo. Nunca apaga conversas, tags ou configurações.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ambienteIsolado, portaLivre } = require('../ajuda');

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
      const qrNovo = fs.existsSync(auth + '.guardado') || fs.existsSync(path.join(dir, '.sofia-limpar-auth')); // subiu com o perfil limpo?
      const estado = aoSubir(qrNovo);
      if (estado) amb.gravarSofia('sofia-wa-status.json', { estado, atualizadoEm: new Date(relogio + 1000).toISOString() });
    },
  };
  return { alvo, chamadas, dir, auth };
}

test('SOF-03 reconectar: volta com o login salvo e não descarta nada', async () => {
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

test('SOF-03 reconectar: se não volta em 2 min com o login salvo, passa sozinho para o QR novo', async () => {
  const amb = ambienteIsolado();
  try {
    // com o login salvo a SoFIA fica "iniciando/desconectado" (como no Lago Norte); sem ele, mostra o QR
    const f = sofiaFalsa(amb, (qrNovo) => (qrNovo ? 'qr' : 'desconectado'));
    const etapas = [];
    const r = await amb.req('sofia-destravar').destravar(f.alvo, (e) => { if (etapas[etapas.length - 1] !== e.etapa) etapas.push(e.etapa); });
    assert.strictEqual(r, 'qr');
    assert.deepStrictEqual(etapas, ['reconectando', 'qr-novo', 'qr']);
    assert.deepStrictEqual(f.chamadas, ['stop unidade-sofia', 'start unidade-sofia', 'stop unidade-sofia', 'start unidade-sofia']);
    assert.ok(!fs.existsSync(path.join(f.auth, 'session', 'login-salvo')), 'no 2º passo a SoFIA sobe sem o login antigo');
    assert.ok(!fs.existsSync(f.auth + '.guardado'), 'o QR apareceu: o login antigo não servia e a cópia guardada é apagada');
    assert.ok(JSON.parse(fs.readFileSync(path.join(f.dir, 'sofia-conversas.json'), 'utf8'))['5562999990001'], 'as conversas não são tocadas');
  } finally { amb.limpar(); }
});

test('SOF-03 reconectar: se nem o QR novo aparece, termina como "falhou" (não fica tentando para sempre)', async () => {
  const amb = ambienteIsolado();
  try {
    const f = sofiaFalsa(amb, () => 'iniciando');
    const r = await amb.req('sofia-destravar').destravar(f.alvo);
    assert.strictEqual(r, 'falhou');
    assert.strictEqual(f.chamadas.filter(c => c.startsWith('start')).length, 3, 'duas tentativas, mais a subida com o login devolvido — e para');
    // o problema NÃO era o login (nem com o perfil limpo o QR apareceu): o login salvo volta para o lugar,
    // para a SoFIA reconectar sozinha quando o WhatsApp liberar, sem precisar do celular
    assert.ok(fs.existsSync(path.join(f.auth, 'session', 'login-salvo')), 'login salvo devolvido');
    assert.ok(!fs.existsSync(f.auth + '.guardado'));
    assert.ok(!fs.existsSync(path.join(f.dir, '.sofia-limpar-auth')), 'e a SoFIA não é mandada apagar o login ao subir');
    const avisos = [];
    const h = sofiaFalsa(amb, () => 'iniciando');
    await amb.req('sofia-destravar').destravar(h.alvo, (e) => avisos.push(e));
    assert.strictEqual(avisos[avisos.length - 1].etapa, 'falhou');
    assert.strictEqual(avisos[avisos.length - 1].loginMantido, true, 'a tela é avisada de que o login foi mantido');
    // um estado ANTIGO de "conectado" (de antes de reiniciar) não engana a espera
    const g = sofiaFalsa(amb, () => '');
    amb.gravarSofia('sofia-wa-status.json', { estado: 'conectado', atualizadoEm: new Date(Date.now() - 3600e3).toISOString() });
    assert.strictEqual(await amb.req('sofia-destravar').destravar(g.alvo), 'falhou');
  } finally { amb.limpar(); }
});

test('SOF-03 SoFIA: a pausa entre as tentativas de conectar é respeitada (o vigia do boot não a atropela)', () => {
  // No Lago Sul 1 (11/2026) o log mostrava "Esperando 4 min antes de tentar de novo" e, 13 s depois,
  // "travou — reiniciando…": o vigia de 75 s reiniciava a SoFIA no meio da pausa, ela batia no
  // WhatsApp sem parar e o contador de falhas andava em dobro (3 → 4, 5 → 6).
  const ts = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'ChatBot', 'sofia-listener.ts'), 'utf8');
  const falha = ts.slice(ts.indexOf('falha ao iniciar o WhatsApp'));
  const ateAPausa = falha.slice(0, falha.indexOf('const n = lerFails() + 1;'));
  assert.match(ateAPausa, /clearTimeout\(bootTimer\)/, 'ao falhar, o vigia do boot é desarmado antes de começar a pausa');
  const num = (nome) => Number((new RegExp(nome + ' \\|\\| "(\\d+)"').exec(ts) || [])[1]);
  const espera = num('SOFIA_AUTH_TIMEOUT_MS'), vigia = num('SOFIA_BOOT_TIMEOUT_MS');
  assert.ok(espera >= 120000, 'a SoFIA espera pelo menos 2 min o WhatsApp abrir');
  assert.ok(vigia > espera, 'o vigia do boot só age depois que a espera do WhatsApp terminou');
  assert.ok(require(path.resolve(__dirname, '..', '..', 'src', 'sofia-destravar.js')).ESPERA_MS > espera, 'o botão do painel espera mais que a própria SoFIA');
  assert.match(falha.slice(0, 3000), /WAWebSocketModel/, 'na falha, o log diz em que estado a conexão do WhatsApp parou');
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

test('SOF-03 PAI-02 no painel: o botão dispara o procedimento na SoFIA desta unidade; quem não tem acesso à Configuração da SoFIA não consegue', { timeout: 120000 }, async () => {
  const amb = ambienteIsolado();
  const porta = await portaLivre();
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
